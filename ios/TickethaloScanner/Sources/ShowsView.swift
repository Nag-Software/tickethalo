import SwiftUI

/// Velg showet døra skal skanne for. Kommende show først — det er nesten
/// alltid kveldens show man leter etter.
struct ShowsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(APIClient.self) private var api
    @State private var me: Me?
    @State private var shows: [Show] = []
    @State private var error: String?
    @State private var isLoading = true
    @State private var showAccessAlert = false

    private var today: Date { Calendar.current.startOfDay(for: Date()) }
    private var upcoming: [Show] {
        shows.filter { ($0.dateValue ?? .distantFuture) >= today }
            .sorted { ($0.dateValue ?? .distantFuture) < ($1.dateValue ?? .distantFuture) }
    }
    private var past: [Show] { shows.filter { ($0.dateValue ?? .distantFuture) < today } }

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(Theme.danger)
                            Button("Try again") { Task { await load() } }
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.accent)
                                .disabled(isLoading)
                        }
                        .padding(.vertical, 4)
                        .listRowBackground(Theme.card)
                    }
                }
                if !upcoming.isEmpty {
                    Section("Upcoming") { ForEach(upcoming) { row($0) } }
                }
                if !past.isEmpty {
                    Section("Past") { ForEach(past) { row($0) } }
                }
                if !isLoading && shows.isEmpty && error == nil {
                    ContentUnavailableView("No shows", systemImage: "ticket", description: Text("Shows that are on sale appear here."))
                        .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .overlay { if isLoading && shows.isEmpty { ProgressView() } }
            .navigationTitle(selectedClubName ?? "Shows")
            .navigationDestination(for: Show.self) { ScannerView(show: $0) }
            .toolbar { toolbar }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private var selectedClubName: String? {
        me?.clubs.first { $0.id == me?.selectedClubId }?.name
    }

    private func row(_ show: Show) -> some View {
        NavigationLink(value: show) {
            VStack(alignment: .leading, spacing: 4) {
                Text(show.title).font(.headline).foregroundStyle(Theme.text)
                Text(show.subtitle).font(.subheadline).foregroundStyle(Theme.muted)
            }
            .padding(.vertical, 4)
        }
        .listRowBackground(Theme.card)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                if let me {
                    // Seksjonstitler vises ikke i menyer på iOS 26 — derfor en egen linje.
                    Text("Signed in as \(me.email)")
                    Section {
                        if me.clubs.count > 1 {
                            Picker("Club", selection: Binding(
                                get: { me.selectedClubId ?? "" },
                                set: { id in
                                    api.clubId = id
                                    Task { await load() }
                                }
                            )) {
                                ForEach(me.clubs) { Text($0.name).tag($0.id) }
                            }
                        }
                    }
                }
                Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    Task { await auth.signOut() }
                }
            } label: {
                Image(systemName: "person.crop.circle")
            }
            .accessibilityLabel("Account")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let me = try await api.me()
            if me.clubs.isEmpty {
                error = "This account isn't connected to a club."
            } else {
                error = nil
            }
            api.clubId = me.selectedClubId
            self.me = me
            shows = try await api.shows()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
