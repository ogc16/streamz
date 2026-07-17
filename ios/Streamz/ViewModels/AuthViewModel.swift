import Foundation
import SwiftUI

@MainActor
final class AuthViewModel: ObservableObject {

    @Published var email = ""
    @Published var password = ""
    @Published var name = ""
    @Published var isRegisterMode = false

    @Published var isLoading = false
    @Published var user: User?
    @Published var errorMessage: String?
    @Published var showError = false

    private let authService = AuthService.shared
    private let client = APIClient.shared

    var isAuthenticated: Bool {
        user != nil
    }

    func checkAuth() async {
        guard client.isAuthenticated else { return }
        do {
            user = try await authService.getMe()
        } catch {
            client.clearTokens()
        }
    }

    func login() async {
        guard !email.isEmpty, !password.isEmpty else {
            errorMessage = "Please enter email and password."
            showError = true
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let response = try await authService.login(email: email, password: password)
            user = response.user
            clearFields()
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isLoading = false
    }

    func register() async {
        guard !email.isEmpty, !password.isEmpty, !name.isEmpty else {
            errorMessage = "Please fill in all fields."
            showError = true
            return
        }

        guard password.count >= 6 else {
            errorMessage = "Password must be at least 6 characters."
            showError = true
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let response = try await authService.register(email: email, password: password, name: name)
            user = response.user
            clearFields()
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isLoading = false
    }

    func logout() async {
        isLoading = true
        do {
            try await authService.logout()
        } catch {
            // Still clear locally even if server call fails
        }
        user = nil
        client.clearTokens()
        isLoading = false
    }

    func submit() async {
        if isRegisterMode {
            await register()
        } else {
            await login()
        }
    }

    private func clearFields() {
        email = ""
        password = ""
        name = ""
    }
}
