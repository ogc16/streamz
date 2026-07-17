import Foundation

final class AuthService {

    static let shared = AuthService()

    private let client = APIClient.shared

    private init() {}

    func register(email: String, password: String, name: String) async throws -> AuthResponse {
        let request = RegisterRequest(email: email, password: password, name: name)
        let response: AuthResponse = try await client.request(
            path: "/api/auth/register",
            method: "POST",
            body: request,
            requireAuth: false
        )
        client.saveTokens(accessToken: response.accessToken, refreshToken: response.refreshToken)
        return response
    }

    func login(email: String, password: String) async throws -> AuthResponse {
        let request = LoginRequest(email: email, password: password)
        let response: AuthResponse = try await client.request(
            path: "/api/auth/login",
            method: "POST",
            body: request,
            requireAuth: false
        )
        client.saveTokens(accessToken: response.accessToken, refreshToken: response.refreshToken)
        return response
    }

    func logout() async throws {
        struct LogoutResponse: Codable {
            let message: String
        }
        let _: LogoutResponse = try await client.request(
            path: "/api/auth/logout",
            method: "POST"
        )
        client.clearTokens()
    }

    func getMe() async throws -> User {
        struct MeResponse: Codable {
            let user: User
        }
        let response: MeResponse = try await client.request(
            path: "/api/auth/me"
        )
        return response.user
    }
}
