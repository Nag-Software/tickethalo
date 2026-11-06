import SwiftUI
import UIKit

/// Døra for ett show: kamera som standard, gjestelista ett trykk unna.
struct ScannerView: View {
    let show: Show

    @Environment(APIClient.self) private var api
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab: Tab = .scan
    @State private var tickets: [Ticket] = []
    @State private var result: ScanOutcome?
    @State private var isProcessing = false
    @State private var cameraFailure: CameraFailure?
    @State private var torchOn = false
    @State private var showManualEntry = false
    @State private var loadError: String?
    @State private var lastCode = ""
    @State private var lastCodeAt = Date.distantPast
    @State private var dismissTask: Task<Void, Never>?

    enum Tab: String, CaseIterable { case scan = "Scan", guests = "Guests" }

    /// Hvor lenge den grønne bekreftelsen står før kameraet er tilbake.
    private let successDuration: Duration = .milliseconds(2500)
    /// Kameraet leser samme QR mange ganger i sekundet. Vinduet må vare
    /// lenger enn bekreftelsen, ellers blir «Let them in» avløst av
    /// «Already checked in» for den samme gjesten.
    private let sameCodeWindow: TimeInterval = 6

    private var checkedIn: Int { tickets.filter(\.isCheckedIn).count }

    var body: some View {
        VStack(spacing: 0) {
            switch tab {
            case .scan: scanner
            case .guests:
                // Lista er lys som resten av appen, under den mørke toppen.
                GuestListView(show: show, tickets: $tickets, onCheckIn: { code in Task { await process(code, force: true) } }, onRefresh: loadTickets)
                    .background(Theme.background)
                    .environment(\.colorScheme, .light)
                    .tint(Theme.accent)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .background(Color.black)
        .navigationBarTitleDisplayMode(.inline)
        // Toppen er alltid mørk her, også på gjestelista. Å bytte modus når
        // fanen byttes etterlot knappene i navigasjonslinja i feil stil
        // (mørk tekst på mørkt glass).
        .tint(.white)
        .preferredColorScheme(.dark)
        // Glasset i navigasjonslinja følger innholdet under — den lyse lista
        // gjorde knappene mørke på svart. Lås linja til mørk.
        .toolbarBackground(Color.black, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
        }
        .sheet(isPresented: $showManualEntry) {
            ManualEntryView { code in Task { await process(code, force: true) } }
                .presentationDetents([.height(260)])
                .presentationBackground(Theme.background)
                .presentationDragIndicator(.visible)
                .tint(Theme.accent)
                .environment(\.colorScheme, .light)
        }
        .task { await loadTickets() }
        .task {
            // Flere telefoner i døra: tellingen holdes i synk.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                await loadTickets()
            }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await loadTickets() } } }
        .onChange(of: tab) { _, _ in torchOn = false }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(show.title)
                .font(.headline)
                .lineLimit(1)
            HStack {
                Text(show.subtitle).lineLimit(1)
                Spacer()
                Text("\(checkedIn) / \(tickets.count) in")
                    .monospacedDigit()
                    .fontWeight(.semibold)
                    .accessibilityIdentifier("checkedInCount")
            }
            .font(.subheadline)
            .opacity(0.75)
            ProgressView(value: Double(checkedIn), total: Double(max(tickets.count, 1)))
                .tint(Theme.accentFill)
            if let loadError {
                Label(loadError, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.dangerOnDark)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal)
        .padding(.bottom, 10)
        .background(Color.black)
    }

    private var scanner: some View {
        ZStack {
            if let cameraFailure {
                VStack(spacing: 16) {
                    Image(systemName: "camera.fill").font(.largeTitle)
                    Text(cameraFailure.message).multilineTextAlignment(.center)
                    if cameraFailure == .denied {
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                    }
                }
                .foregroundStyle(.white)
                .padding(32)
            } else {
                CameraScanner(
                    torchOn: torchOn,
                    onCode: { code in Task { await process(code) } },
                    onFailure: { cameraFailure = $0 }
                )
                .ignoresSafeArea(edges: .bottom)
                viewfinder
            }

            if let result {
                ResultOverlay(outcome: result) { dismissResult() }
                    .transition(.opacity)
            }

            VStack {
                Spacer()
                HStack(spacing: 14) {
                    Button { showManualEntry = true } label: {
                        Label("Type code", systemImage: "keyboard")
                            .frame(maxWidth: .infinity)
                    }
                    .accessibilityIdentifier("typeCodeButton")
                    if cameraFailure == nil {
                        Button { torchOn.toggle() } label: {
                            Image(systemName: torchOn ? "flashlight.on.fill" : "flashlight.off.fill")
                                .frame(width: 24)
                        }
                        .accessibilityLabel(torchOn ? "Turn off flashlight" : "Turn on flashlight")
                    }
                }
                .font(.headline)
                .padding(.vertical, 14)
                .padding(.horizontal, 20)
                .foregroundStyle(.white)
                .background(.ultraThinMaterial.opacity(0.9), in: Capsule())
                .environment(\.colorScheme, .dark)
                .padding()
                .opacity(result == nil ? 1 : 0)
            }

            if isProcessing {
                ProgressView().tint(.white).scaleEffect(1.5)
            }
        }
        .animation(.easeOut(duration: 0.15), value: result)
    }

    private var viewfinder: some View {
        RoundedRectangle(cornerRadius: 24)
            .stroke(.white.opacity(0.85), lineWidth: 3)
            .frame(width: 250, height: 250)
            .shadow(color: .black.opacity(0.4), radius: 8)
            .allowsHitTesting(false)
    }

    // MARK: - Actions

    private func loadTickets() async {
                do {
            tickets = try await api.show(show.id).tickets
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func process(_ raw: String, force: Bool = false) async {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, !isProcessing else { return }
        if !force, code == lastCode, Date().timeIntervalSince(lastCodeAt) < sameCodeWindow { return }
        lastCode = code
        lastCodeAt = Date()

        isProcessing = true
        defer { isProcessing = false }

        do {
            let response = try await api.checkIn(showId: show.id, code: code)
            if case .ok(let ticketId, _, _) = response, let index = tickets.firstIndex(where: { $0.id == ticketId }) {
                tickets[index].status = "used"
                tickets[index].checked_in_at = ISO8601DateFormatter().string(from: Date())
            }
            present(ScanOutcome(response))
        } catch {
            present(ScanOutcome(tone: .error, title: "Couldn't check in", subtitle: error.localizedDescription))
            // Prøv igjen straks — feilen var nettet, ikke billetten.
            lastCode = ""
        }
    }

    private func present(_ outcome: ScanOutcome) {
        dismissTask?.cancel()
        result = outcome
        let haptics = UINotificationFeedbackGenerator()
        switch outcome.tone {
        case .success: haptics.notificationOccurred(.success)
        case .warning: haptics.notificationOccurred(.warning)
        case .error: haptics.notificationOccurred(.error)
        }
        // Bare «slipp inn» forsvinner av seg selv. Et nei skal vakta se og
        // trykke bort — det er da de må snakke med gjesten.
        if outcome.tone == .success {
            dismissTask = Task {
                try? await Task.sleep(for: successDuration)
                if !Task.isCancelled { result = nil }
            }
        }
    }

    private func dismissResult() {
        dismissTask?.cancel()
        result = nil
    }
}

struct ScanOutcome: Equatable {
    enum Tone { case success, warning, error }
    let tone: Tone
    let title: String
    let subtitle: String

    init(tone: Tone, title: String, subtitle: String) {
        self.tone = tone
        self.title = title
        self.subtitle = subtitle
    }

    init(_ result: CheckInResult) {
        switch result {
        case .ok(_, _, let name):
            self.init(tone: .success, title: "Let them in", subtitle: name)
        case .alreadyUsed(let checkedInAt, let holderName):
            let time = Timestamp.clock(checkedInAt).map { "Checked in at \($0)" }
            self.init(tone: .warning, title: "Already checked in", subtitle: [holderName, time].compactMap { $0 }.joined(separator: " · "))
        case .wrongShow(let title, let date, let holderName):
            self.init(tone: .error, title: "Wrong show", subtitle: [holderName, "Ticket for \(title) · \(date)"].compactMap { $0 }.joined(separator: " · "))
        case .invalid(let status):
            self.init(tone: .error, title: "Invalid ticket", subtitle: status == "refunded" ? "This ticket was refunded" : status == "cancelled" ? "This ticket was cancelled" : status)
        case .notFound:
            self.init(tone: .error, title: "Not found", subtitle: "Unknown ticket code")
        }
    }
}

private struct ResultOverlay: View {
    let outcome: ScanOutcome
    let onDismiss: () -> Void

    private var color: Color {
        switch outcome.tone {
        case .success: Theme.success
        case .warning: Theme.warning
        case .error: Theme.danger
        }
    }

    private var icon: String {
        switch outcome.tone {
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.circle.fill"
        case .error: "xmark.circle.fill"
        }
    }

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: icon).font(.system(size: 96))
            Text(outcome.title)
                .font(.system(size: 36, weight: .bold))
                .accessibilityIdentifier("scanResultTitle")
            if !outcome.subtitle.isEmpty {
                Text(outcome.subtitle)
                    .font(.title3)
                    .multilineTextAlignment(.center)
            }
            if outcome.tone != .success {
                Text("Tap to scan next")
                    .font(.subheadline)
                    .opacity(0.8)
                    .padding(.top, 24)
            }
        }
        .foregroundStyle(.white)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(color.ignoresSafeArea())
        .contentShape(Rectangle())
        .onTapGesture(perform: onDismiss)
        .accessibilityAddTraits(.isButton)
    }
}

private struct ManualEntryView: View {
    let onSubmit: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Type ticket code").font(.title3.bold())
            TextField("ABCD-1234", text: $code)
                .font(.title2.monospaced())
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .focused($focused)
                .submitLabel(.go)
                .onSubmit(submit)
                .fieldStyle()
                .accessibilityIdentifier("manualCodeField")
            Button(action: submit) {
                Text("Check in")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.text, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(Theme.accentInk)
            }
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(24)
        .frame(maxHeight: .infinity, alignment: .top)
        .onAppear { focused = true }
    }

    private func submit() {
        // Bindestreken er bare for lesbarhet — koden lagres uten.
        let cleaned = code.replacingOccurrences(of: "-", with: "").replacingOccurrences(of: " ", with: "")
        guard !cleaned.isEmpty else { return }
        dismiss()
        onSubmit(cleaned)
    }
}
