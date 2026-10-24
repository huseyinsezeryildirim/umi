import CoreGraphics
import Foundation

/// Every non-destructive edit of a recording. Stored in project.json; the source
/// tracks are never modified. All sizes are fractions so they're resolution-independent,
/// and all times are recording (source) time unless noted.
///
/// Decoding is tolerant: any missing or unreadable field falls back to its default, so
/// projects saved by older versions keep opening as new fields are added.
nonisolated struct EditSettings: Codable, Hashable, Sendable {
    // Canvas
    var background = Background.gradient(.sky)
    /// Gradient direction in degrees (0 = left→right, 90 = bottom→top).
    var backgroundAngle = 135.0
    /// Film grain over the background, 0…1.
    var backgroundNoise = 0.0
    var frame = DeviceFrame.none
    /// Output shape of the video.
    var aspect = AspectRatio.auto
    /// Part of the screen recording to keep, normalized (top-left origin); nil = all of it.
    var crop: CGRect?
    /// Space around the screen, as a fraction of the canvas' shorter side.
    var padding = 0.08
    /// Screen corner radius, as a fraction of the screen's shorter side.
    var cornerRadius = 0.025
    /// 0…1
    var shadow = 0.6
    /// Border around the screen, as a fraction of the screen's shorter side (0 = none).
    var border = 0.0

    var cursor = Cursor()
    var camera = Camera()
    var zoom = Zoom()
    var masks: [PrivacyMask] = []
    var scenes: [SceneSegment] = []
    var grade = ColorGrade()
    var texts: [TextOverlay] = []
    var moves: [CameraMove] = []
    var captions = Captions()

    /// Kept parts of the recording, in recording time, in play order. Empty = everything.
    var clips: [Clip] = []
    /// Cross-dissolve between consecutive clips, in seconds (0 = hard cut).
    var crossfade = 0.0
    var music: Music?
    /// Extra videos and images on the Media track (B-roll, logos, screenshots).
    var overlays: [MediaOverlay] = []
    /// A logo kept in a corner for the whole video.
    var watermark: Watermark?

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = EditSettings()
        background = c.value(.background, d.background)
        backgroundAngle = c.value(.backgroundAngle, d.backgroundAngle)
        backgroundNoise = c.value(.backgroundNoise, d.backgroundNoise)
        frame = c.value(.frame, d.frame)
        aspect = c.value(.aspect, d.aspect)
        crop = c.value(.crop, d.crop)
        padding = c.value(.padding, d.padding)
        cornerRadius = c.value(.cornerRadius, d.cornerRadius)
        shadow = c.value(.shadow, d.shadow)
        border = c.value(.border, d.border)
        cursor = c.value(.cursor, d.cursor)
        camera = c.value(.camera, d.camera)
        zoom = c.value(.zoom, d.zoom)
        masks = c.value(.masks, d.masks)
        scenes = c.value(.scenes, d.scenes)
        grade = c.value(.grade, d.grade)
        texts = c.value(.texts, d.texts)
        moves = c.value(.moves, d.moves)
        captions = c.value(.captions, d.captions)
        clips = c.value(.clips, d.clips)
        crossfade = c.value(.crossfade, d.crossfade)
        music = c.value(.music, d.music)
        overlays = c.value(.overlays, d.overlays)
        watermark = c.value(.watermark, d.watermark)
    }

    // MARK: Canvas

    enum Background: Codable, Hashable, Sendable {
        case color(RGBA)
        case gradient(GradientPreset)
        /// An image file: a macOS wallpaper path or a file copied into the project.
        case image(String)
        /// The recording itself, blurred and dimmed, behind the screen card.
        case blurredScreen
    }

    enum GradientPreset: String, Codable, CaseIterable, Sendable {
        case sky, ice, navy, graphite, mist, mint, sand, dusk
        // Earlier presets, still decodable for existing projects.
        case ocean, peach, grape, night, umay

        /// Presets offered in the editor.
        static let pickable: [GradientPreset] = [.sky, .ice, .navy, .graphite, .mist, .mint, .sand, .dusk]

        var colors: (RGBA, RGBA) {
            switch self {
            case .sky: (RGBA(0.62, 0.80, 0.98), RGBA(0.18, 0.37, 0.72))
            case .ice: (RGBA(0.95, 0.97, 0.99), RGBA(0.80, 0.88, 0.97))
            case .navy: (RGBA(0.18, 0.33, 0.53), RGBA(0.06, 0.09, 0.17))
            case .graphite: (RGBA(0.25, 0.27, 0.32), RGBA(0.06, 0.07, 0.10))
            case .mist: (RGBA(0.93, 0.94, 0.96), RGBA(0.72, 0.75, 0.81))
            case .dusk: (RGBA(0.98, 0.45, 0.42), RGBA(0.42, 0.29, 0.86))
            case .ocean: (RGBA(0.13, 0.60, 0.95), RGBA(0.08, 0.20, 0.55))
            case .mint: (RGBA(0.55, 0.93, 0.76), RGBA(0.11, 0.55, 0.55))
            case .peach: (RGBA(1.00, 0.80, 0.62), RGBA(0.96, 0.47, 0.52))
            case .grape: (RGBA(0.80, 0.45, 0.95), RGBA(0.30, 0.15, 0.60))
            case .night: (RGBA(0.20, 0.22, 0.30), RGBA(0.05, 0.05, 0.09))
            case .sand: (RGBA(0.96, 0.91, 0.82), RGBA(0.82, 0.71, 0.58))
            case .umay: (RGBA(1.00, 0.62, 0.78), RGBA(0.55, 0.78, 1.00))
            }
        }
    }

    enum AspectRatio: String, Codable, CaseIterable, Sendable {
        case auto, wide, vertical, square, classic, portrait

        var label: String {
            switch self {
            case .auto: "Auto"
            case .wide: "16:9 Wide"
            case .vertical: "9:16 Vertical"
            case .square: "1:1 Square"
            case .classic: "4:3 Classic"
            case .portrait: "4:5 Portrait"
            }
        }

        /// Width / height; nil = follow the recording.
        var ratio: Double? {
            switch self {
            case .auto: nil
            case .wide: 16.0 / 9
            case .vertical: 9.0 / 16
            case .square: 1
            case .classic: 4.0 / 3
            case .portrait: 4.0 / 5
            }
        }
    }

    /// Chrome drawn around the screen.
    enum DeviceFrame: String, Codable, CaseIterable, Sendable {
        case none, macOS, windows, browser, macBook

        var label: String {
            switch self {
            case .none: "None"
            case .macOS: "macOS"
            case .windows: "Windows"
            case .browser: "Browser"
            case .macBook: "MacBook"
            }
        }
    }

    // MARK: Cursor, camera, zoom

    struct Cursor: Codable, Hashable, Sendable {
        enum Style: String, Codable, CaseIterable, Sendable { case arrow, dot }

        var visible = true
        /// Multiplier on the system cursor size.
        var size = 1.5
        var smoothing = Smoothing.smooth
        var clickRings = true
        /// The macOS arrow, or a soft dot (touch-style highlight).
        var style = Style.arrow
        /// Ghost trail when the cursor moves fast.
        var motionBlur = true
        /// Fade the cursor out after it rests for a moment.
        var hideWhenIdle = false

        init() {}

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let d = Cursor()
            visible = c.value(.visible, d.visible)
            size = c.value(.size, d.size)
            smoothing = c.value(.smoothing, d.smoothing)
            clickRings = c.value(.clickRings, d.clickRings)
            style = c.value(.style, d.style)
            motionBlur = c.value(.motionBlur, d.motionBlur)
            hideWhenIdle = c.value(.hideWhenIdle, d.hideWhenIdle)
        }
    }

    enum Smoothing: String, Codable, CaseIterable, Sendable {
        case off, slow, smooth, fast

        /// Spring (tension, friction); nil = raw cursor.
        var spring: (tension: Double, friction: Double)? {
            switch self {
            case .off: nil
            case .slow: (90, 20)
            case .smooth: (170, 26)
            case .fast: (400, 40)
            }
        }
    }

    struct Camera: Codable, Hashable, Sendable {
        var visible = true
        var shape = Shape.circle
        /// Diameter as a fraction of the canvas' shorter side.
        var size = 0.24
        /// Center, normalized to the canvas (top-left origin).
        var position = CGPoint(x: 0.14, y: 0.80)
        var mirrored = true

        enum Shape: String, Codable, CaseIterable, Sendable {
            case circle, squircle, square
        }
    }

    struct Zoom: Codable, Hashable, Sendable {
        /// Generate zoom segments from clicks.
        var auto = true
        var scale = 1.8
        /// Manual segments; when `auto` is on they're added to the generated ones.
        var segments: [ZoomSegment] = []
    }

    struct ZoomSegment: Codable, Hashable, Sendable, Identifiable {
        static let scaleRange = 1.0...4.5
        var id = UUID()
        var start: Double
        var end: Double
        var scale: Double
        /// Fixed focus (normalized screen, top-left origin); nil = follow the cursor.
        var focus: CGPoint?
    }

    // MARK: Privacy

    struct PrivacyMask: Codable, Hashable, Sendable, Identifiable {
        enum Style: String, Codable, CaseIterable, Sendable { case blur, pixelate, highlight }
        var id = UUID()
        var start: Double
        var end: Double
        /// Area on the screen, normalized, top-left origin.
        var rect: CGRect
        var style = Style.blur
        /// Blur radius / pixel size / dimming, 0…1.
        var amount = 0.6
    }

    // MARK: Scenes

    enum SceneLayout: String, Codable, CaseIterable, Sendable {
        case `default`, cameraOnly, hideCamera, splitScreen, floating

        var label: String {
            switch self {
            case .default: "Default"
            case .cameraOnly: "Camera Only"
            case .hideCamera: "Hide Camera"
            case .splitScreen: "Split Screen"
            case .floating: "Floating"
            }
        }
    }

    /// A stretch of the timeline with its own screen/camera layout. Outside every
    /// segment the layout is `.default`. Layout changes animate over `transition` seconds.
    struct SceneSegment: Codable, Hashable, Sendable, Identifiable {
        var id = UUID()
        var start: Double
        var end: Double
        var layout: SceneLayout
        var transition = 0.4
    }

    // MARK: Color

    enum GradePreset: String, Codable, CaseIterable, Sendable {
        case none, cinematic, noir, vintage, frost, golden, midnight, vivid, dreamy
    }

    struct ColorGrade: Codable, Hashable, Sendable {
        var preset = GradePreset.none
        /// −1…1
        var exposure = 0.0
        var contrast = 0.0
        var saturation = 0.0
        /// 0…1
        var vignette = 0.0
        var grain = 0.0
    }

    // MARK: Text

    enum TextStyle: String, Codable, CaseIterable, Sendable {
        case title, lowerThird, kicker, bigStat, quote, typewriter

        var label: String {
            switch self {
            case .title: "Title"
            case .lowerThird: "Lower Third"
            case .kicker: "Kicker"
            case .bigStat: "Big Stat"
            case .quote: "Quote"
            case .typewriter: "Typewriter"
            }
        }
    }

    enum TextAnimation: String, Codable, CaseIterable, Sendable {
        case fade, slide, pop, typewriter
    }

    struct TextOverlay: Codable, Hashable, Sendable, Identifiable {
        var id = UUID()
        var start: Double
        var end: Double
        var style: TextStyle
        var text: String
        /// Secondary line (lower third role, stat caption, quote author).
        var detail = ""
        /// Anchor, normalized to the canvas (top-left origin).
        var position: CGPoint
        var animation = TextAnimation.slide
    }

    // MARK: 3D

    enum MoveKind: String, Codable, CaseIterable, Sendable {
        case glide, unfold, pullBack

        var label: String {
            switch self {
            case .glide: "Glide across"
            case .unfold: "Unfold"
            case .pullBack: "Pull back"
            }
        }
    }

    struct CameraMove: Codable, Hashable, Sendable, Identifiable {
        var id = UUID()
        var start: Double
        var end: Double
        var kind: MoveKind
    }

    // MARK: Captions

    struct Captions: Codable, Hashable, Sendable {
        var enabled = false
        var words: [CaptionWord] = []
        var language = "en-US"
        /// Text height as a fraction of the canvas height.
        var size = 0.045
        /// Vertical position of the caption line's center, normalized (top-left origin).
        var position = 0.86
        var highlightActiveWord = true
    }

    struct CaptionWord: Codable, Hashable, Sendable, Identifiable {
        var id = UUID()
        var start: Double
        var end: Double
        var text: String
    }

    // MARK: Clips and audio

    struct Clip: Codable, Hashable, Sendable {
        var start: Double
        var end: Double
        /// Playback speed, 0.25…8.
        var speed = 1.0

        var duration: Double { end - start }
        /// Length on the output timeline.
        var outputDuration: Double { duration / speed }

        init(start: Double, end: Double, speed: Double = 1) {
            self.start = start
            self.end = end
            self.speed = speed
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            start = try c.decode(Double.self, forKey: .start)
            end = try c.decode(Double.self, forKey: .end)
            speed = c.value(.speed, 1)
        }
    }

    /// A video or image placed on the Media track. Unlike other items it is timed on the
    /// output timeline, so it stays put when the recording underneath is cut.
    struct MediaOverlay: Codable, Hashable, Sendable, Identifiable {
        enum Kind: String, Codable, Sendable { case video, image }
        enum Mode: String, Codable, CaseIterable, Sendable {
            /// Covers the screen (B-roll); background and camera stay visible.
            case fill
            /// A card on top of the screen.
            case pictureInPicture
        }

        var id = UUID()
        /// File name inside the project bundle.
        var file: String
        var kind: Kind
        /// Output time.
        var start: Double
        var end: Double
        /// Where in the overlay video playback starts (trimming its head).
        var mediaOffset = 0.0
        var mode = Mode.fill
        /// Picture-in-picture card: center (normalized canvas, top-left origin) and width.
        var center = CGPoint(x: 0.72, y: 0.3)
        var width = 0.4
    }

    struct Watermark: Codable, Hashable, Sendable {
        enum Corner: String, Codable, CaseIterable, Sendable { case topLeft, topRight, bottomLeft, bottomRight }
        /// Image file inside the project bundle.
        var file: String
        var corner = Corner.bottomRight
        /// Width as a fraction of the canvas width.
        var size = 0.12
        var opacity = 0.85
    }

    struct Music: Codable, Hashable, Sendable {
        /// File name inside the project bundle.
        var file: String
        /// Display name (library tracks); the file name otherwise.
        var title: String?
        var volume = 0.35
        /// Fade the music out over the last seconds.
        var fadeOut = 2.0
    }
}

nonisolated struct RGBA: Codable, Hashable, Sendable {
    var r, g, b, a: Double
    init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }
}

nonisolated struct TimeRangeValue: Codable, Hashable, Sendable {
    var start: Double
    var end: Double
    var duration: Double { end - start }
}

nonisolated extension KeyedDecodingContainer {
    /// The decoded value, or `fallback` when the key is missing or unreadable.
    func value<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }
}
