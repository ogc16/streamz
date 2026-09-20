import SwiftUI

struct VideoDetailView: View {
    let videoId: String
    @StateObject private var vm = VideoDetailViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var showPlayer = false
    @State private var playbackUrl: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if vm.isConfirmingPayment {
                VStack(spacing: 12) {
                    ProgressView().tint(.white)
                    Text("Confirming payment...")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                }
            } else if vm.isLoading {
                ProgressView().tint(.white)
            } else if let video = vm.video {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        heroSection(video: video)
                        infoSection(video: video)
                        actionButtons
                    }
                }
            } else {
                Text("Video not found.")
                    .foregroundColor(.gray)
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: { dismiss() }) {
                    Image(systemName: "chevron.left")
                        .foregroundColor(.white)
                }
            }
        }
        .sheet(isPresented: $showPlayer) {
            if let url = playbackUrl {
                PlayerView(playbackURL: url, title: vm.video?.title ?? "")
            }
        }
        .sheet(isPresented: $vm.showPaymentSheet) {
            if let clientSecret = vm.paymentClientSecret {
                PurchaseView(
                    clientSecret: clientSecret,
                    amount: vm.paymentAmount ?? 0,
                    onCompleted: {
                        Task { await vm.paymentCompleted() }
                    },
                    onFailed: {
                        vm.paymentFailed()
                    }
                )
            }
        }
        .task {
            await vm.loadVideo(id: videoId)
        }
        .alert("Error", isPresented: $vm.showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(vm.errorMessage ?? "Something went wrong.")
        }
        .alert("Purchase Complete", isPresented: $vm.purchaseCompleted) {
            Button("Watch Now") {
                Task { await startPlayback() }
            }
            Button("OK", role: .cancel) {}
        } message: {
            Text("You now have access to this video!")
        }
    }

    // MARK: - Hero Section

    private func heroSection(video: VideoDetailResponse) -> some View {
        ZStack(alignment: .bottomLeading, content: {
            AsyncImage(url: URL(string: video.thumbnailUrl ?? "")) { phase in
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
            .frame(height: 280)
            .clipped()

            LinearGradient(
                colors: [.clear, .black.opacity(0.95)],
                startPoint: .center,
                endPoint: .bottom
            )
            .frame(height: 280)

            if vm.hasAccess {
                Button(action: {
                    Task { await startPlayback() }
                }) {
                    HStack {
                        Image(systemName: "play.fill")
                        Text("Watch Now")
                            .font(.headline)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(
                        LinearGradient(
                            colors: [.red, .red.opacity(0.8)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .cornerRadius(25)
                }
                .padding()
            }
        })
    }

    // MARK: - Info Section

    private func infoSection(video: VideoDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(video.title)
                .font(.title.bold())
                .foregroundColor(.white)

            HStack(spacing: 12) {
                if let year = video.releaseYear {
                    Text("\(year)")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                }

                Text(video.genre)
                    .font(.subheadline)
                    .foregroundColor(.gray)

                if let rating = video.rating {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .foregroundColor(.yellow)
                            .font(.caption)
                        Text(rating)
                            .font(.subheadline)
                            .foregroundColor(.gray)
                    }
                }

                Text(video.durationDisplay)
                    .font(.subheadline)
                    .foregroundColor(.gray)
            }

            Text(video.description)
                .font(.body)
                .foregroundColor(.white.opacity(0.8))
                .lineSpacing(4)
                .padding(.top, 4)
        }
        .padding()
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 12) {
            if vm.hasAccess {
                Button(action: {
                    Task { await startPlayback() }
                }) {
                    HStack {
                        Image(systemName: "play.fill")
                        Text("Watch Now")
                    }
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
            } else {
                if let video = vm.video {
                    HStack(spacing: 12) {
                        Button(action: {
                            Task { await vm.initiatePurchase(type: "buy") }
                        }) {
                            VStack(spacing: 4) {
                                Text("Buy")
                                    .font(.headline)
                                Text(video.priceDisplay)
                                    .font(.caption)
                            }
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

                        Button(action: {
                            Task { await vm.initiatePurchase(type: "rent") }
                        }) {
                            VStack(spacing: 4) {
                                Text("Rent \(video.rentalDurationHours ?? 0)h")
                                    .font(.headline)
                                Text(video.rentalPriceDisplay)
                                    .font(.caption)
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(Color.white.opacity(0.15))
                            .cornerRadius(12)
                        }
                    }
                }
            }
        }
        .padding()
    }

    private func startPlayback() async {
        do {
            let url = try await vm.getPlaybackUrl()
            playbackUrl = url
            showPlayer = true
        } catch {
            vm.errorMessage = error.localizedDescription
            vm.showError = true
        }
    }
}
