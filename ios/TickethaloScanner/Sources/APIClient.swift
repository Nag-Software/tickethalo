import Foundation
import Observation

enum APIError: LocalizedError {
    case signedOut
    case invalidCredentials
    case forbidden(String)
    case server(String)
    case offline

    var errorDescription: String? {
        switch self {
        case .signedOut: "You have been signed out. Please sign in again."
        case .invalidCredentials: "Wrong email or password."
        case .forbidden(let message): message
        case .server(let message): message
        case .offline: "No connection. Check your internet and try again."
        }
    }
}

/// Snakker med `/api/scanner/*` på tickethalo.com.
@MainActor
@Observable
final class APIClient {
    @ObservationIgnored let auth: AuthStore
    /// Klubben som er valgt i appen. Sendes med hver forespørsel — serveren
    /// godtar den bare blant klubbene brukeren faktisk har tilgang til.
    var clubId: String? {
        get { UserDefaults.standard.string(forKey: "selectedClubId") }
        set { UserDefaults.standard.set(newValue, forKey: "selectedClubId") }
    }

    init(auth: AuthStore) { self.auth = auth }

    func me() async throws -> Me { try await send("api/scanner/me") }

    func shows() async throws -> [Show] {
        struct Response: Decodable { let shows: [Show] }
        let response: Response = try await send("api/scanner/shows")
        return response.shows
    }

    func show(_ id: String) async throws -> ShowDetail { try await send("api/scanner/shows/\(id)") }

    func checkIn(showId: String, code: String) async throws -> CheckInResult {
        try await send("api/scanner/shows/\(showId)/check-in", body: ["code": code])
    }

    func undo(showId: String, ticketId: String) async throws {
        struct Response: Decodable { let ok: Bool }
        let _: Response = try await send("api/scanner/shows/\(showId)/undo", body: ["ticketId": ticketId])
    }

    private struct ErrorResponse: Decodable { let error: String }

    private func send<T: Decodable>(_ path: String, body: [String: String]? = nil, retried: Bool = false) async throws -> T {
        #if DEBUG
        if Demo.isEnabled {
            try await Task.sleep(for: .milliseconds(250))
            return try JSONDecoder().decode(T.self, from: Demo.response(path: path, body: body))
        }
        #endif
        var request = URLRequest(url: Config.apiBaseURL.appending(path: path))
        request.timeoutInterval = 15
        request.setValue("Bearer \(try await auth.validAccessToken())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let clubId { request.setValue(clubId, forHTTPHeaderField: "X-Tickethalo-Club") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost].contains(error.code) {
            throw APIError.offline
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error

        switch status {
        case 200..<300:
            return try JSONDecoder().decode(T.self, from: data)
        case 401 where !retried:
            // Tokenet kan være trukket tilbake før det gikk ut. Forny én gang.
            try await auth.refresh()
            return try await send(path, body: body, retried: true)
        case 401:
            auth.clear()
            throw APIError.signedOut
        case 403:
            throw APIError.forbidden(message ?? "You don't have access to this.")
        default:
            throw APIError.server(message ?? "Something went wrong (\(status)).")
        }
    }
}
