// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "CouncilCore", platforms: [.iOS(.v18), .macOS(.v14)], products: [.library(name: "CouncilCore", targets: ["CouncilCore"])], dependencies: [.package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.9.0")], targets: [.target(name: "CouncilCore", dependencies: [.product(name: "GRDB", package: "GRDB.swift")]), .testTarget(name: "CouncilCoreTests", dependencies: ["CouncilCore"])])
