# Shoga Viewer
Shoga Viewer is a high-performance image viewer specifically optimized for **ChromeOS-powered tablets and laptops**. It provides a fluid, distraction-free environment, leveraging modern browser capabilities to deliver a local-first experience with uncompromising speed on ChromeOS devices.

## Key Attributes
* **FileSystem Integration**: Direct access to local directories via the FileSystem Access API, ensuring privacy and eliminating the need for file uploads.
* **Hardware Acceleration**: Efficient thumbnail generation and hardware-accelerated image decoding for near-zero latency, even with thousands of assets.
* **Adaptive Layouts**: Seamless switching between Single and Spread (dual-page) modes, with support for LTR/RTL reading directions and multiple viewport fit options.
* **Fluid Interaction**: Precision-tuned touch and mouse gestures for zooming, panning, and navigation, optimized for ChromeOS tablet and laptop workflows.
* **Session Persistence**: Automatic tracking of recent sessions and specific reading points (bookmarks) using IndexedDB.

## Usage Guide

### 1. Data Input
Click the folder icon in the top navigation bar and select **"SELECT DIRECTORY"**. Once folder access is granted, the engine will index all image assets within the directory and display them in the grid view.

### 2. Navigation
* **Browsing**: Use the grid view for a high-level overview. Tap or click any thumbnail to enter the viewer.
* **Paging**: Swipe horizontally, use the keyboard arrow keys, or tap the outer 15% of the screen to move between images.
* **Home**: The home icon resets the current library and returns to the initial landing screen.

### 3. Display Control
* **Zoom & Pan**: Use a mouse wheel or pinch gesture to zoom. Click/touch and drag to move through enlarged images. Double-tap to reset the view to its original scale.
* **Interface Visibility**: Tap the center of the screen to toggle the visibility of the navigation and status bars.
* **Settings**: Adjust the layout architecture (Single/Spread), reading direction, and image fit modes (Contain, Width, Height, Original) through the settings panel.

### 4. Bookmarks
Save your current position by clicking **"+ ADD"** in the Bookmarks panel. Each bookmark captures the exact file index and layout preferences, allowing for instantaneous session restoration.

## System Requirements

| Feature | Minimum | Recommended |
|:---|:---|:---|
| **Processor** | Snapdragon 7c / Intel Celeron N4020 | Snapdragon 7c Gen 2 / Intel Core i3 |
| **Memory** | 4GB RAM | 8GB RAM |
| **Display** | 1280 x 720 | 1920 x 1080 |

## License
Copyright © 2026 D5 Kan. Distributed under the [MIT License](LICENSE).
