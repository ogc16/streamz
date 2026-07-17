import SwiftUI

struct HomeView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var homeVM = HomeViewModel()
    @State private var selectedVideoId: String?
    @State private var showProfile = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                if homeVM.isLoading && homeVM.videos.isEmpty {
                    ProgressView()
                        .tint(.white)
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 24) {
                            searchBar
                            featuredSection
                            genreChips
                            videoGrid
                            if homeVM.isLoading && !homeVM.videos.isEmpty {
                                ProgressView()
                                    .tint(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding()
                            }
                        }
                    }
                    .refreshable {
                        await homeVM.refresh()
                    }
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text("Streamz")
                        .font(.title2.bold())
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.red, .orange],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { showProfile = true }) {
                        Image(systemName: "person.circle.fill")
                            .font(.title2)
                            .foregroundColor(.white)
                    }
                }
            }
            .navigationDestination(isPresented: $showProfile) {
                ProfileView()
                    .environmentObject(authVM)
            }
            .navigationDestination(item: $selectedVideoId) { videoId in
                VideoDetailView(videoId: videoId)
            }
        }
        .task {
            await homeVM.loadInitial()
        }
        .alert("Error", isPresented: $homeVM.showError) {
            Button("OK", role: .cancel) {}
            Button("Retry") {
                Task { await homeVM.loadInitial() }
            }
        } message: {
            Text(homeVM.errorMessage ?? "Something went wrong.")
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.gray)

            TextField("Search movies & shows...", text: $homeVM.searchQuery)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: homeVM.searchQuery) { _, _ in
                    Task { await homeVM.search() }
                }

            if !homeVM.searchQuery.isEmpty {
                Button(action: {
                    homeVM.searchQuery = ""
                    Task { await homeVM.search() }
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.gray)
                }
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.1))
        .cornerRadius(12)
        .padding(.horizontal)
    }

    // MARK: - Featured Hero Section

    private var featuredSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                ForEach(homeVM.featuredVideos) { video in
                    Button(action: { selectedVideoId = video.id }) {
                        ZStack(alignment: .bottomLeading, content: {
                            AsyncImage(url: URL(string: video.thumbnailUrl ?? "")) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fill)
                                case .failure:
                                    thumbnailPlaceholder
                                case .empty:
                                    thumbnailPlaceholder
                                        .overlay(ProgressView().tint(.white))
                                @unknown default:
                                    thumbnailPlaceholder
                                }
                            }
                            .frame(width: 340, height: 200)
                            .clipped()
                            .cornerRadius(12)

                            LinearGradient(
                                colors: [.clear, .black.opacity(0.9)],
                                startPoint: .center,
                                endPoint: .bottom
                            )
                            .cornerRadius(12)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(video.title)
                                    .font(.title2.bold())
                                    .foregroundColor(.white)

                                HStack(spacing: 8) {
                                    if let year = video.releaseYear {
                                        Text("\(year)")
                                            .font(.caption)
                                            .foregroundColor(.gray)
                                    }
                                    Text(video.genre)
                                        .font(.caption)
                                        .foregroundColor(.gray)
                                    Text(video.priceDisplay)
                                        .font(.caption.bold())
                                        .foregroundColor(.green)
                                }
                            }
                            .padding()
                        })
                        .frame(width: 340, height: 200)
                    }
                }
            }
            .padding(.horizontal)
        }
    }

    // MARK: - Genre Chips

    private var genreChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                GenreChip(
                    title: "All",
                    isSelected: homeVM.selectedGenre == nil,
                    action: { Task { await homeVM.selectGenre(nil) } }
                )

                ForEach(homeVM.genres) { genre in
                    GenreChip(
                        title: genre.genre.capitalized,
                        isSelected: homeVM.selectedGenre == genre.genre,
                        action: { Task { await homeVM.selectGenre(genre.genre) } }
                    )
                }
            }
            .padding(.horizontal)
        }
    }

    // MARK: - Video Grid

    private var videoGrid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
            spacing: 16
        ) {
            ForEach(homeVM.filteredVideos) { video in
                Button(action: { selectedVideoId = video.id }) {
                    VideoCard(video: video)
                }
                .onAppear {
                    if video.id == homeVM.filteredVideos.last?.id {
                        Task { await homeVM.loadMore() }
                    }
                }
            }
        }
        .padding(.horizontal)
    }

    private var thumbnailPlaceholder: some View {
        Rectangle()
            .fill(Color.gray.opacity(0.3))
            .frame(width: 340, height: 200)
            .cornerRadius(12)
    }
}

// MARK: - Genre Chip

struct GenreChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.medium())
                .foregroundColor(isSelected ? .white : .gray)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    isSelected
                        ? LinearGradient(colors: [.red, .red.opacity(0.8)], startPoint: .leading, endPoint: .trailing)
                        : LinearGradient(colors: [.white.opacity(0.1)], startPoint: .leading, endPoint: .trailing)
                )
                .cornerRadius(20)
        }
    }
}

// MARK: - Video Card

struct VideoCard: View {
    let video: Video

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: URL(string: video.thumbnailUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    cardPlaceholder
                case .empty:
                    cardPlaceholder
                        .overlay(ProgressView().tint(.white))
                @unknown default:
                    cardPlaceholder
                }
            }
            .frame(height: 180)
            .clipped()
            .cornerRadius(8)

            Text(video.title)
                .font(.subheadline.bold())
                .foregroundColor(.white)
                .lineLimit(1)

            HStack {
                Text(video.genre)
                    .font(.caption)
                    .foregroundColor(.gray)
                Spacer()
                Text(video.priceDisplay)
                    .font(.caption.bold())
                    .foregroundColor(.green)
            }
        }
    }

    private var cardPlaceholder: some View {
        Rectangle()
            .fill(Color.gray.opacity(0.3))
            .frame(height: 180)
            .cornerRadius(8)
    }
}
