import Foundation
import SwiftUI

@MainActor
final class VideoDetailViewModel: ObservableObject {

    @Published var video: VideoDetailResponse?
    @Published var accessCheck: AccessCheckResponse?
    @Published var isLoading = false
    @Published var isPurchasing = false
    @Published var errorMessage: String?
    @Published var showError = false
    @Published var showPaymentSheet = false
    @Published var paymentClientSecret: String?
    @Published var paymentAmount: Int?
    @Published var purchaseCompleted = false

    private let videoService = VideoService.shared
    private let purchaseService = PurchaseService.shared
    private let streamingService = StreamingService.shared

    var hasAccess: Bool {
        accessCheck?.hasAccess == true
    }

    var isPurchased: Bool {
        video?.purchased == true
    }

    var videoId: String?

    func loadVideo(id: String) async {
        videoId = id
        isLoading = true
        errorMessage = nil

        do {
            async let videoTask = videoService.fetchVideo(id: id)
            async let accessTask = purchaseService.checkAccess(videoId: id)

            let (videoResult, accessResult) = try await (videoTask, accessTask)

            video = videoResult
            accessCheck = accessResult
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isLoading = false
    }

    func initiatePurchase(type: String) async {
        guard let id = videoId else { return }
        isPurchasing = true
        errorMessage = nil

        do {
            let response = try await purchaseService.createPaymentIntent(videoId: id, type: type)
            paymentClientSecret = response.clientSecret
            paymentAmount = response.amount
            showPaymentSheet = true
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isPurchasing = false
    }

    func paymentCompleted() async {
        showPaymentSheet = false
        purchaseCompleted = true
        guard let id = videoId else { return }

        // Re-check access after payment
        do {
            let access = try await purchaseService.checkAccess(videoId: id)
            accessCheck = access
            // Reload video to get updated purchased status
            video = try await videoService.fetchVideo(id: id)
        } catch {
            // Payment went through but refresh failed
        }
    }

    func paymentFailed() {
        showPaymentSheet = false
        paymentClientSecret = nil
    }

    func getPlaybackUrl() async throws -> String {
        guard let playbackId = video?.playbackId else {
            throw APIError.invalidResponse
        }
        return try await streamingService.getPlaybackUrl(playbackId: playbackId)
    }
}
