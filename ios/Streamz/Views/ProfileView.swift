import SwiftUI

struct ProfileView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var purchases: [PurchaseWithVideo] = []
    @State private var isLoadingPurchases = true
    @State private var showPlayer = false
    @State private var playbackURL: String?
    @State private var playerTitle = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 24) {
                        profileHeader
                        purchasedVideosSection
                    }
                    .padding()
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.white)
                    }
                }
            }
            .sheet(isPresented: $showPlayer) {
                if let url = playbackURL {
                    PlayerView(playbackURL: url, title: playerTitle)
                }
            }
            .task {
                await loadPurchases()
            }
        }
    }

    // MARK: - Profile Header

    private var profileHeader: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.red)

            VStack(spacing: 4) {
                Text(authVM.user?.name ?? "User")
                    .font(.title2.bold())
                    .foregroundColor(.white)

                Text(authVM.user?.email ?? "")
                    .font(.subheadline)
                    .foregroundColor(.gray)
            }

            Button(action: {
                Task {
                    await authVM.logout()
                }
            }) {
                Text("Sign Out")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(12)
            }
        }
        .padding(.vertical)
    }

    // MARK: - Purchased Videos

    private var purchasedVideosSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("My Library")
                .font(.title3.bold())
                .foregroundColor(.white)

            if isLoadingPurchases {
                ProgressView()
                    .tint(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
            } else if purchases.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "film")
                        .font(.largeTitle)
                        .foregroundColor(.gray)
                    Text("No purchases yet")
                        .foregroundColor(.gray)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            } else {
                ForEach(purchases) { item in
                    Button(action: {
                        Task { await watchVideo(item: item) }
                    }) {
                        HStack(spacing: 12) {
                            AsyncImage(url: URL(string: item.video.thumbnailUrl ?? "")) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                default:
                                    Rectangle()
                                        .fill(Color.gray.opacity(0.3))
                                }
                            }
                            .frame(width: 100, height: 60)
                            .cornerRadius(6)
                            .clipped()

                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.video.title)
                                    .font(.subheadline.bold())
                                    .foregroundColor(.white)
                                    .lineLimit(1)

                                Text(item.purchase.type.capitalized)
                                    .font(.caption)
                                    .foregroundColor(.red)

                                if let expires = item.purchase.expiresAt {
                                    Text("Expires: \(expires)")
                                        .font(.caption2)
                                        .foregroundColor(.gray)
                                }
                            }

                            Spacer()

                            Image(systemName: "play.circle.fill")
                                .font(.title2)
                                .foregroundColor(.white)
                        }
                        .padding(8)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(10)
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func loadPurchases() async {
        let service = PurchaseService.shared
        do {
            purchases = try await service.getPurchases()
        } catch {
            // Silent fail for purchases list
        }
        isLoadingPurchases = false
    }

    private func watchVideo(item: PurchaseWithVideo) async {
        let streamingService = StreamingService.shared
        do {
            guard let playbackId = item.video.playbackId, !playbackId.isEmpty else { return }
            let url = try await streamingService.getPlaybackUrl(playbackId: playbackId)
            playbackURL = url
            playerTitle = item.video.title
            showPlayer = true
        } catch {
            // Could show alert
        }
    }
}
