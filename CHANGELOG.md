# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-18

### Added
- Add context graph — MOC-based skill navigation across 4 workflow phases (3ae9432)
- Add graphs for command > agent > skill flow (3fbebda)
- Add harness engineering: stabilization cycle, Definition of Done, golden principles, and automated hooks (bc975f0)
- Add WCAG accessibility skill — 30 rules across 8 categories (3ae9432)
- Add browser-verify skill (f36b5f6)
- Add review-pr skill (2d9ec09)
- Add ctx7 CLI skill and README (f081526)
- Add RTK, high-performance CLI proxy that reduces LLM token consumption by 60-90% (6ab0c22)

### Changed
- Update skill-creator with evals and benchmarking (b7d05f5)
- Update agent-browser (84516af)
- Replace MCP usage with CLI+Skill approach (7721cb4)

### Fixed
- Fix table appearance (62c17dd)
- Fix brainstorm to ask about libraries (68df0e0)
- Fix agent-browser to use CLI (624b262)

### Removed
- Remove prompt enhancer (1aa103a)

## [1.0.0] - 2026-02-10

### Added
- Add task management system (4d6da8e)
- Add new documentation system and flow (a8ca446)
- Add changelog/release skill (d712cc5)
- Add React best practices skill (8135458)
- Add git worktrees support (f08ed46)
- Add document generation capabilities (86a4fdf)
- Add task tool integration in commands (94fde83)
- Add updated agent configurations (a2d4edc)
- Include project-generator in flow (e1416b3)
- Add new flow without orchestration (71f7071)
- Add README (dd8064f)
- Add release workflow and skill updates (ee0e08f)

### Fixed
- Fix folder structure (f566ece)
- Fix lint spec descriptions (1aa3cf1)
- Fix manifest path resolution (5360449)
- Fix absolute paths (493d639)
- Fix worktree variant selection (853b0e4)
- Simplify commands (67c6841)
- Remove unnecessary commands (c0a595d)
- Fix lint issues (1e44a91)
