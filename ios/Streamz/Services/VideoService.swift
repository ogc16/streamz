import Foundation

final class VideoService {

    static let shared = VideoService()

    private let client = APIClient.shared

    private init() {}

    func fetchFeatured() async throws -> [Video] {
        try await client.request(path: "/api/videos/featured")
    }

    func fetchVideos(
        genre: String? = nil,
        featured: Bool? = nil,
        search: String? = nil,
        page: Int = 1,
        limit: Int = 20,
        sort: String = "created_at",
        order: String = "desc"
    ) async throws -> VideoListResponse {
        var components = URLComponents(string: client.baseURL.absoluteString + "/api/videos")!
        var queryItems = [URLQueryItem]()

        if let genre = genre, !genre.isEmpty {
            queryItems.append(URLQueryItem(name: "genre", value: genre))
        }
        if let featured = featured {
            queryItems.append(URLQueryItem(name: "featured", value: String(featured)))
        }
        if let search = search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        queryItems.append(URLQueryItem(name: "page", value: String(page)))
        queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        queryItems.append(URLQueryItem(name: "sort", value: sort))
        queryItems.append(URLQueryItem(name: "order", value: order))

        components.queryItems = queryItems

        guard let url = components.url else {
            throw APIError.invalidResponse
        }

        let path = url.path + (url.query.map { "?\($0)" } ?? "")
        return try await client.request(path: path)
    }

    func fetchVideo(id: String) async throws -> VideoDetailResponse {
        try await client.request(path: "/api/videos/\(id)")
    }

    func fetchGenres() async throws -> [GenreCount] {
        try await client.request(path: "/api/videos/genres")
    }
}
