# Documentation

Start with the section that matches your task. Commands assume the repository
root unless a guide says otherwise.

| I want to…                             | Start here                                          |
| -------------------------------------- | --------------------------------------------------- |
| Install or use Holocron                | [User guides](user/README.md)                       |
| Set up a checkout, build or test       | [Development](development/README.md)                |
| Understand the runtime or telemetry    | [Architecture and protocol](architecture/README.md) |
| Work with models, textures or licenses | [Assets](assets/README.md)                          |
| Prepare or publish a version           | [Releases](releases/README.md)                      |
| Use or maintain cargo automation       | [Trader and autopilot](trader/README.md)            |
| Check galaxy maps and flight evidence  | [Navigation](navigation/README.md)                  |
| Review project direction               | [Roadmap](roadmap.md)                               |
| Read older decisions and evaluations   | [History](history/README.md)                        |

The pending [0.1.14 release handoff](releases/release-0.1.14.md) contains the
private asset-upload checklist and bundle checksums.

## Keeping documentation organized

- Put user-facing instructions in `user/`, build/test guides in `development/`,
  and technical contracts in `architecture/`.
- Keep model notes under `assets/models/` and version handoffs under `releases/`.
  Link new pages from their section index.
- Keep superseded reviews in a topic's `history/` directory, clearly labeled and
  linked to current guidance. Do not mix old and current release status.
- Keep executable sources, runtime data and generated binaries outside `docs/`.
- Use relative links and update inbound references when moving a guide.

[Project README](../README.md)
