import Foundation

/// Hvor appen henter data fra.
///
/// Supabase-nøkkelen er den publiserbare (samme som nettsiden sender til
/// nettleseren), så den kan ligge i appen. Debug-bygg snakker med
/// utviklingsserveren på Macen — simulatoren når den på localhost.
enum Config {
    static let supabaseURL = URL(string: "https://nwsrqzsvorrokosacfjy.supabase.co")!
    static let supabasePublishableKey = "sb_publishable_2TXVOSrAg9MDarEVvsqN_Q_EiQG4TdZ"

    #if DEBUG
    /// `TICKETHALO_API_URL` i schemets miljø peker et debug-bygg et annet sted,
    /// f.eks. `http://localhost:3030` eller en preview-deploy.
    static let apiBaseURL = ProcessInfo.processInfo.environment["TICKETHALO_API_URL"]
        .flatMap(URL.init(string:)) ?? URL(string: "http://localhost:3000")!
    #else
    static let apiBaseURL = URL(string: "https://tickethalo.com")!
    #endif

    static let forgotPasswordURL = URL(string: "https://tickethalo.com/admin-app/login")!
}
