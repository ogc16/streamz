import Foundation

struct User: Codable, Identifiable {
    let id: String
    let email: String
    let name: String
    let stripeCustomerId: String?
    let createdAt: String?
}

struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct RegisterRequest: Codable {
    let email: String
    let password: String
    let name: String
}

struct AuthResponse: Codable {
    let user: User
    let accessToken: String
    let refreshToken: String
}
