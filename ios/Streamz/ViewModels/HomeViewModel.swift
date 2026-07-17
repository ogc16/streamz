import Foundation
import SwiftUI

@MainActor
final class HomeViewModel: ObservableObject {

    @Published var featuredVideos: [Video] = []
    @Published var videos: [Video] = []
    @Published var genres: [GenreCount] = []
    @Published var selectedGenre: String?
    @Published var searchQuery = ""
    @Published var isLoading = false
    @Published var isRefreshing = false
    @Published var errorMessage: String?
    @Published var showError = false

    @Published var currentPage = 1
    @Published var hasMorePages = true

    private let videoService = VideoService.shared
    private var searchTask: Task<Void, Never>?

    var filteredVideos: [Video] {
        videos
    }

    func loadInitial() async {
        isLoading = true
        errorMessage = nil

        do {
            async let featuredTask = videoService.fetchFeatured()
            async let videosTask = videoService.fetchVideos(page: 1, limit: 20)
            async let genresTask = videoService.fetchGenres()

            let (featured, videoResponse, genreList) = try await (featuredTask, videosTask, genresTask)

            featuredVideos = featured
            videos = videoResponse.items
            genres = genreList
            currentPage = 1
            hasMorePages = videoResponse.items.count < videoResponse.total
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isLoading = false
    }

    func refresh() async {
        isRefreshing = true
        currentPage = 1
        hasMorePages = true

        do {
            async let featuredTask = videoService.fetchFeatured()
            async let videosTask = videoService.fetchVideos(
                genre: selectedGenre,
                search: searchQuery.isEmpty ? nil : searchQuery,
                page: 1,
                limit: 20
            )

            let (featured, videoResponse) = try await (featuredTask, videosTask)

            featuredVideos = featured
            videos = videoResponse.items
            hasMorePages = videoResponse.items.count < videoResponse.total
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isRefreshing = false
    }

    func loadMore() async {
        guard hasMorePages, !isLoading else { return }
        isLoading = true

        do {
            let nextPage = currentPage + 1
            let response = try await videoService.fetchVideos(
                genre: selectedGenre,
                search: searchQuery.isEmpty ? nil : searchQuery,
                page: nextPage,
                limit: 20
            )
            videos.append(contentsOf: response.items)
            currentPage = nextPage
            hasMorePages = videos.count < response.total
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isLoading = false
    }

    func selectGenre(_ genre: String?) async {
        selectedGenre = genre
        currentPage = 1
        hasMorePages = true
        isLoading = true

        do {
            let response = try await videoService.fetchVideos(
                genre: genre,
                search: searchQuery.isEmpty ? nil : searchQuery,
                page: 1,
                limit: 20
            )
            videos = response.items
            hasMorePages = response.items.count < response.total
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isLoading = false
    }

    func search() async {
        searchTask?.cancel()

        searchTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }

            currentPage = 1
            hasMorePages = true
            isLoading = true

            do {
                let response = try await videoService.fetchVideos(
                    genre: selectedGenre,
                    search: searchQuery.isEmpty ? nil : searchQuery,
                    page: 1,
                    limit: 20
                )
                videos = response.items
                hasMorePages = response.items.count < response.total
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }

            isLoading = false
        }
    }
}
