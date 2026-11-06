import SwiftUI

@main
struct TickethaloScannerApp: App {
    @State private var auth: AuthStore
    @State private var api: APIClient

    init() {
        let auth = AuthStore()
        _auth = State(initialValue: auth)
        _api = State(initialValue: APIClient(auth: auth))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch auth.state {
                case .loading:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.background.ignoresSafeArea())
                case .signedOut:
                    LoginView()
                case .signedIn:
                    ShowsView()
                }
            }
            .environment(auth)
            .environment(api)
            .tint(Theme.accent)
            // Lys modus kommer fra UIUserInterfaceStyle i Info.plist. En
            // preferredColorScheme her ville overstyrt skannerens mørke
            // statuslinje.
        }
    }
}
