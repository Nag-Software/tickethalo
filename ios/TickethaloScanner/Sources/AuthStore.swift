import Foundation
import Observation

/// Innlogging mot Supabase Auth, samme kontoer som admin-portalen.
///
/// Appen bruker REST-endepunktene direkte i stedet for supabase-swift: den
/// trenger bare passordinnlogging, fornyelse og utlogging, og da slipper
/// prosjektet en pakkeavhengighet.
@MainActor
@Observable
final class AuthStore {
    struct Session: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
        var email: String
    }

    enum State { case loading, signedOut, signedIn }

    private(set) var state: State = .loading
    private(set) var session: Session?
    private var refreshTask: Task<Session, Error>?

    private static let keychainKey = "session"

    init() {
        #if DEBUG
        if Demo.isEnabled {
            session = Demo.session
            state = .signedIn
            return
        }
        #endif
        if let data = Keychain.load(Self.keychainKey),
           let saved = try? JSONDecoder().decode(Session.self, from: data) {
            session = saved
            state = .signedIn
        } else {
            state = .signedOut
        }
    }

    var email: String? { session?.email }

    func signIn(email: String, password: String) async throws {
        let body = ["email": email.trimmingCharacters(in: .whitespaces), "password": password]
        let session = try await tokenRequest(grantType: "password", body: body)
        store(session)
    }

    func signOut() async {
        if let token = session?.accessToken {
            var request = URLRequest(url: Config.supabaseURL.appending(path: "auth/v1/logout"))
            request.httpMethod = "POST"
            request.setValue(Config.supabasePublishableKey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: request)
        }
        clear()
    }

    func clear() {
        Keychain.delete(Self.keychainKey)
        session = nil
        state = .signedOut
    }

    /// Et gyldig tilgangstoken — fornyet først hvis det er under ett minutt igjen.
    func validAccessToken() async throws -> String {
        guard let current = session else { throw APIError.signedOut }
        if current.expiresAt.timeIntervalSinceNow > 60 { return current.accessToken }
        return try await refresh().accessToken
    }

    /// Fornyer tokenet. Samtidige kall deler én forespørsel: Supabase roterer
    /// refresh-tokenet, så to parallelle fornyelser ville logget brukeren ut.
    @discardableResult
    func refresh() async throws -> Session {
        if let refreshTask { return try await refreshTask.value }
        guard let current = session else { throw APIError.signedOut }

        let task = Task { () throws -> Session in
            try await tokenRequest(grantType: "refresh_token", body: ["refresh_token": current.refreshToken])
        }
        refreshTask = task
        defer { refreshTask = nil }

        do {
            let fresh = try await task.value
            store(fresh)
            return fresh
        } catch APIError.invalidCredentials {
            clear()
            throw APIError.signedOut
        }
    }

    private func store(_ session: Session) {
        self.session = session
        if let data = try? JSONEncoder().encode(session) {
            Keychain.save(data, for: Self.keychainKey)
        }
        state = .signedIn
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double
        let user: User
        struct User: Decodable { let email: String? }
    }

    private struct AuthErrorResponse: Decodable {
        let error_description: String?
        let msg: String?
        let message: String?
    }

    private func tokenRequest(grantType: String, body: [String: String]) async throws -> Session {
        var components = URLComponents(url: Config.supabaseURL.appending(path: "auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: grantType)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Config.supabasePublishableKey, forHTTPHeaderField: "apikey")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(status) else {
            if (400..<500).contains(status) { throw APIError.invalidCredentials }
            let detail = try? JSONDecoder().decode(AuthErrorResponse.self, from: data)
            throw APIError.server(detail?.error_description ?? detail?.msg ?? detail?.message ?? "Sign-in failed (\(status)).")
        }

        let token = try JSONDecoder().decode(TokenResponse.self, from: data)
        return Session(
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date().addingTimeInterval(token.expires_in),
            email: token.user.email ?? body["email"] ?? session?.email ?? ""
        )
    }
}
