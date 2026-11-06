import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var isSubmitting = false
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 14) {
                    Image("Logo")
                        .resizable()
                        .frame(width: 44, height: 44)
                        .foregroundStyle(Theme.text)
                    Text("Door scanner")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(Theme.text)
                    Text("Sign in with your Tickethalo club account to check in guests.")
                        .font(.body)
                        .foregroundStyle(Theme.muted)
                }
                .padding(.top, 48)

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .fieldStyle()

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .fieldStyle()
                }

                if let error {
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("loginError")
                }

                Button(action: submit) {
                    HStack {
                        if isSubmitting { ProgressView().tint(Theme.accentInk) }
                        Text(isSubmitting ? "Signing in…" : "Sign in")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Theme.text, in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(Theme.accentInk)
                }
                .disabled(isSubmitting || email.isEmpty || password.isEmpty)
                .opacity(email.isEmpty || password.isEmpty ? 0.5 : 1)

                Link("Forgot your password?", destination: Config.forgotPasswordURL)
                    .font(.subheadline)
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background.ignoresSafeArea())
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty, !isSubmitting else { return }
        error = nil
        isSubmitting = true
        Task {
            do {
                try await auth.signIn(email: email, password: password)
            } catch {
                self.error = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}

extension View {
    func fieldStyle() -> some View {
        self
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
            .foregroundStyle(Theme.text)
    }
}
