import Foundation

final class APIClient {

    static let shared = APIClient()

    let baseURL = URL(string: "http://localhost:3000")!

    private let session: URLSession
    private let decoder: JSONDecoder
    private var refreshTask: Task<String, Error>?

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        self.decoder = JSONDecoder()
    }

    // MARK: - Token Management

    var accessToken: String? {
        get { KeychainManager.shared.read(key: "accessToken") }
        set {
            if let value = newValue {
                KeychainManager.shared.save(key: "accessToken", value: value)
            } else {
                KeychainManager.shared.delete(key: "accessToken")
            }
        }
    }

    var refreshToken: String? {
        get { KeychainManager.shared.read(key: "refreshToken") }
        set {
            if let value = newValue {
                KeychainManager.shared.save(key: "refreshToken", value: value)
            } else {
                KeychainManager.shared.delete(key: "refreshToken")
            }
        }
    }

    var isAuthenticated: Bool {
        accessToken != nil
    }

    func saveTokens(accessToken: String, refreshToken: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }

    func clearTokens() {
        accessToken = nil
        refreshToken = nil
    }

    // MARK: - Generic Request

    func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        requireAuth: Bool = true
    ) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if requireAuth, let token = accessToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = body {
            let encoder = JSONEncoder()
            urlRequest.httpBody = try encoder.encode(body)
        }

        let (data, response) = try await session.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 && requireAuth {
            let newToken = try await refreshAccessToken()
            urlRequest.setValue("Bearer \(newToken)", forHTTPHeaderField: "Authorization")
            let (retryData, retryResponse) = try await session.data(for: urlRequest)
            guard let retryHttpResponse = retryResponse as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(retryHttpResponse.statusCode) else {
                let errorBody = String(data: retryData, encoding: .utf8) ?? "Unknown error"
                throw APIError.serverError(statusCode: retryHttpResponse.statusCode, message: errorBody)
            }
            return try decoder.decode(T.self, from: retryData)
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.serverError(statusCode: httpResponse.statusCode, message: errorBody)
        }

        return try decoder.decode(T.self, from: data)
    }

    // MARK: - Token Refresh

    private func refreshAccessToken() async throws -> String {
        if let task = refreshTask {
            return try await task.value
        }

        let task = Task<String, Error> {
            defer { refreshTask = nil }

            guard let refresh = refreshToken else {
                throw APIError.notAuthenticated
            }

            let url = baseURL.appendingPathComponent("/api/auth/refresh")
            var urlRequest = URLRequest(url: url)
            urlRequest.httpMethod = "POST"
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

            let body = ["refreshToken": refresh]
            urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (data, response) = try await session.data(for: urlRequest)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                clearTokens()
                throw APIError.notAuthenticated
            }

            let tokenResponse = try decoder.decode(AuthResponse.self, from: data)
            saveTokens(accessToken: tokenResponse.accessToken, refreshToken: tokenResponse.refreshToken)

            return tokenResponse.accessToken
        }

        refreshTask = task
        return try await task.value
    }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidResponse
    case serverError(statusCode: Int, message: String)
    case notAuthenticated
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid server response."
        case .serverError(_, let message):
            return message
        case .notAuthenticated:
            return "Session expired. Please log in again."
        case .decodingError:
            return "Failed to decode response."
        case .networkError(let error):
            return error.localizedDescription
        }
    }
}
