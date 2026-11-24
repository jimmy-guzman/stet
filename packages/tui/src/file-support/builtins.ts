import type { FileAssociation } from "./model";

/** Named Nerd Font glyphs for Trees icon tokens, user associations, and tree chrome. */
export const builtinIcons = new Map<string, string>([
  ["archive", "\u{F1C6}"],
  ["c", "\u{E61E}"],
  ["cpp", "\u{E61D}"],
  ["font", "\u{F031}"],
  ["graphql", "\u{E7F4}"],
  ["sass", "\u{E74B}"],
  ["svelte", "\u{E8B7}"],
  ["swift", "\u{E755}"],
  ["wasm", "\u{E8E0}"],
  ["zig", "\u{E8EF}"],
  ["file", "\u{EA7B}"],
  ["folder", "\u{F0256}"],
  ["folder-open", "\u{F0DCF}"],
  ["symlink", "\u{F481}"],
  ["config", "\u{E615}"],
  ["typescript", "\u{E8CA}"],
  ["react", "\u{E7BA}"],
  ["javascript", "\u{E781}"],
  ["json", "\u{F0626}"],
  ["markdown", "\u{EB1D}"],
  ["css", "\u{E749}"],
  ["csv", "\u{E64A}"],
  ["spreadsheet", "\u{E6A6}"],
  ["profile", "\u{EAF2}"],
  ["database", "\u{E706}"],
  ["document", "\u{F0219}"],
  ["html", "\u{E736}"],
  ["http", "\u{F1D8}"],
  ["astro", "\u{E6B3}"],
  ["vue", "\u{E6A0}"],
  ["template", "\u{F505}"],
  ["pdf", "\u{F1C1}"],
  ["rust", "\u{E7A8}"],
  ["python", "\u{E73C}"],
  ["go", "\u{E724}"],
  ["ruby", "\u{E739}"],
  ["shell", "\u{EBCA}"],
  ["toml", "\u{E6B2}"],
  ["yaml", "\u{E8EB}"],
  ["lock", "\u{F023}"],
  ["image", "\u{F1C5}"],
  ["video", "\u{F1C8}"],
  ["java", "\u{E738}"],
  ["kotlin", "\u{E634}"],
  ["groovy", "\u{E775}"],
  ["scala", "\u{E737}"],
  ["gradle", "\u{E7F2}"],
  ["node", "\u{E718}"],
  ["tsconfig", "\u{E69D}"],
  ["bun", "\u{E76F}"],
  ["docker", "\u{E7B0}"],
  ["make", "\u{E673}"],
  ["license", "\u{E60A}"],
  ["git", "\u{F02A2}"],
  ["readme", "\u{EAA4}"],
  ["codeowners", "\u{F510}"],
  ["heroku", "\u{E607}"],
  ["maven", "\u{E674}"],
  ["test", "\u{EA79}"],
  ["storybook", "\u{E8B3}"],
]);

/**
 * Syntax overrides layered over filename inference, plus the icon rules that must beat Trees:
 * test and story files over their language icon, ecosystem filenames Trees reads as JSON or
 * nothing, and `.csv` over Trees' table icon. Readme and license documents resolve in
 * `icon-resolver.ts`, where Trees' token can tell a document from code named after one.
 * Single extensions Trees lacks fall back there too, so they never shadow a Trees filename
 * such as `bun.lock`.
 * A compound extension that fallback cannot express, such as `*.rb.tmpl`, is a narrow glob here,
 * which shadows no Trees filename.
 */
export const builtinFiles = new Map<string, FileAssociation>([
  ["icon-csv", { extensions: ["csv"], icon: "csv" }],
  [
    "icon-go-filenames",
    { filenames: ["go.mod", "go.sum", "go.work"], icon: "go" },
  ],
  ["icon-node-filename", { filenames: ["package.json"], icon: "node" }],
  [
    "icon-tsconfig-filename",
    { filenames: ["tsconfig.json"], icon: "tsconfig" },
  ],
  ["icon-makefile", { filenames: ["makefile"], icon: "make" }],
  ["icon-codeowners", { filenames: ["codeowners"], icon: "codeowners" }],
  ["icon-procfile", { filenames: ["procfile"], icon: "heroku" }],
  [
    "icon-gradle-filenames",
    {
      filenames: [
        "build.gradle",
        "settings.gradle",
        "build.gradle.kts",
        "settings.gradle.kts",
        "gradle.properties",
        "gradle-wrapper.properties",
        "gradlew",
        "gradlew.bat",
      ],
      icon: "gradle",
    },
  ],
  ["icon-maven-filename", { filenames: ["pom.xml"], icon: "maven" }],
  [
    "icon-test",
    {
      globs: [
        "*.test.*",
        "*.spec.*",
        "*_test.*",
        "*_spec.*",
        "*.cy.*",
        "test_*.*",
      ],
      icon: "test",
    },
  ],
  [
    "icon-storybook",
    { globs: ["*.stories.*", "*.story.*"], icon: "storybook" },
  ],
  ["syntax-env", { filenames: [".env"], syntax: "dotenv" }],
  ["syntax-npmrc", { filenames: [".npmrc"], syntax: "ini" }],
  ["syntax-prettierrc", { filenames: [".prettierrc"], syntax: "jsonc" }],
  ["syntax-gradle", { globs: ["*.gradle"], syntax: "groovy" }],
  ["icon-ruby-template", { globs: ["*.rb.tmpl"], icon: "ruby" }],
  ["syntax-ruby-template", { globs: ["*.rb.tmpl"], syntax: "ruby" }],
  ["syntax-svg", { extensions: ["svg"], syntax: "xml" }],
]);
