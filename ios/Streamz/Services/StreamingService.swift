import Foundation

final class StreamingService {

    static let shared = StreamingService()

    private let client = APIClient.shared

    private init() {}

    func getPlaybackUrl(playbackId: String) async throws -> String {
        struct PlaybackResponse: Decodable {
            let playbackUrl: String
            let playbackId: String
        }
        let response: PlaybackResponse = try await client.request(
            path: "/api/stream/playback/\(playbackId)"
        )
        return response.playbackUrl
    }
}
