// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "NodeMode",
    platforms: [
        .iOS(.v15),
        .macOS(.v12)
    ],
    products: [
        .library(
            name: "NodeMode",
            targets: ["NodeMode"]
        ),
    ],
    dependencies: [
        // Add external dependencies here if needed
    ],
    targets: [
        .target(
            name: "NodeMode",
            dependencies: [],
            path: "Sources",
            resources: [
                .process("Resources")
            ],
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency"),
                .define("DEBUG", .when(configuration: .debug))
            ]
        ),
        .testTarget(
            name: "NodeModeTests",
            dependencies: ["NodeMode"],
            path: "Tests"
        ),
    ]
)
