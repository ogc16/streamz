import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authVM: AuthViewModel

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 8) {
                    Text("Streamz")
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.red, .orange],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )

                    Text(authVM.isRegisterMode ? "Create Account" : "Sign In")
                        .font(.title3)
                        .foregroundStyle(.gray)
                }
                .padding(.bottom, 48)

                VStack(spacing: 16) {
                    if authVM.isRegisterMode {
                        TextField("Name", text: $authVM.name)
                            .textFieldStyle(.plain)
                            .padding()
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(12)
                            .autocorrectionDisabled()
                    }

                    TextField("Email", text: $authVM.email)
                        .textFieldStyle(.plain)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding()
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(12)

                    SecureField("Password", text: $authVM.password)
                        .textFieldStyle(.plain)
                        .textContentType(authVM.isRegisterMode ? .newPassword : .password)
                        .padding()
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(12)
                }
                .padding(.horizontal, 32)

                if authVM.isLoading {
                    ProgressView()
                        .tint(.white)
                        .padding(.top, 24)
                } else {
                    Button(action: {
                        Task { await authVM.submit() }
                    }) {
                        Text(authVM.isRegisterMode ? "Create Account" : "Sign In")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(
                                LinearGradient(
                                    colors: [.red, .red.opacity(0.8)],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .cornerRadius(12)
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 24)
                }

                Button(action: {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        authVM.isRegisterMode.toggle()
                        authVM.errorMessage = nil
                    }
                }) {
                    Text(authVM.isRegisterMode
                         ? "Already have an account? Sign In"
                         : "Don't have an account? Create one")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                }
                .padding(.top, 16)

                Spacer()
                Spacer()
            }
        }
        .alert("Error", isPresented: $authVM.showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(authVM.errorMessage ?? "An error occurred.")
        }
    }
}
