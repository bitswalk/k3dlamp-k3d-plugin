# k3dlamp k3d plugin

[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/bitswalk)](https://artifacthub.io/packages/search?repo=bitswalk)

A Headlamp Desktop plugin that creates and deletes k3d clusters. It is built for [k3dlamp](https://github.com/bitswalk/k3dlamp) and published on [Artifact Hub](https://artifacthub.io/packages/headlamp/bitswalk/k3dlamp-k3d-plugin).

The plugin checks that k3d works, lists its clusters, creates a cluster from a k3d config file, and deletes one. k3d adds each new cluster to the default kubeconfig. Headlamp watches that file, so the cluster appears in the cluster list as `k3d-<name>`.

## Requirements

**This plugin works only in a Headlamp desktop build whose `app-build-manifest.json` grants it three k3d commands.** Headlamp runs a plugin's local commands only when the build's manifest grants them, and stock Headlamp releases grant none to this plugin. Installed there, the plugin shows a notice listing the missing grants instead of the k3d page.

k3dlamp is a Headlamp build with these grants. To use the plugin in your own build, you need:

- Headlamp v0.46.0 or later, the first release with the `runCommands` manifest field.
- Docker and [k3d](https://k3d.io) on the `PATH` the app starts with.
- A `runCommands` policy that names this plugin and grants the commands in [`command-grants.json`](command-grants.json).

| Invocation | Match | Plugin use |
| --- | --- | --- |
| `k3d cluster list -o json` | Exact | Checks that k3d runs and lists clusters |
| `k3d cluster create --config <path>` | Prefix | Creates a cluster from a config file |
| `k3d cluster delete <name>` | Prefix | Deletes a cluster |

For the plugin installed from Artifact Hub, the policy is:

```json
{
  "environment": "production",
  "pluginLocation": "user",
  "plugins": [
    {
      "bundleName": "k3dlamp-k3d-plugin",
      "packageName": "@bitswalk/headlamp-k3d",
      "artifactHubPackage": "bitswalk/k3dlamp-k3d-plugin"
    }
  ],
  "commands": [
    { "tool": "k3d", "args": ["cluster", "list", "-o", "json"] },
    { "tool": "k3d", "args": ["cluster", "create", "--config"], "allowTrailingArgs": true },
    { "tool": "k3d", "args": ["cluster", "delete"], "allowTrailingArgs": true }
  ]
}
```

Headlamp's [command capabilities guide](https://headlamp.dev/docs/latest/development/plugins/command-capabilities) recommends also pinning `artifactHubPackageId` and `artifactHubRepositoryId`; [k3dlamp's manifest](https://github.com/bitswalk/k3dlamp/blob/main/app-build-manifest.json) shows them. A policy for the `user` location can't pre-approve commands, so Headlamp asks for consent the first time each of the three runs, and remembers the answer.

The plugin appends exactly one argument to `create` and to `delete`. It rejects a path or name that starts with `-`, so `--all` and extra flags can't get through. `src/k3d.ts` is the only module that runs a command, and a unit test fails if its argv drifts from `command-grants.json`.

The plugin builds against `@kinvolk/headlamp-plugin` 0.14.0, which predates the `PluginRunCommand` type, so `k3d.ts` declares that type itself.

## What it reports

| Situation | What the k3d page shows |
| --- | --- |
| The build grants no k3d command, or this is a browser deployment | A notice listing the three grants it needs |
| `k3d` isn't on `PATH` | "k3d is not installed, or not on the PATH this app was started with." |
| Consent was denied | "The k3d command was denied in the consent prompt, and the app keeps that choice." |
| k3d fails, for example Docker is down | k3d's own stderr |

## Develop

Requires Node 22.

```bash
npm ci
npm test && npm run tsc && npm run lint
```

To try a change in a k3dlamp development run, build the plugin into k3dlamp's development plugin directory. Set `K3DLAMP_PLUGINS_DIR` if yours differs from `~/.config/k3dlamp/plugins`.

```bash
npm run dev:install
```

### Dependency overrides

`overrides` in `package.json` moves build and test tooling that `@kinvolk/headlamp-plugin` pulls in past known vulnerabilities. None of it ends up in `dist/main.js`. `headlamp-plugin upgrade` resets `overrides` to the SDK template, so restore these entries after upgrading, and drop each one once the SDK's own range reaches a fixed version.

| Override | Why |
| --- | --- |
| `typescript` 5.6.2 | From the SDK template. |
| `vitest`, `@vitest/coverage-istanbul` 4.1.12 | The SDK asks for vitest 3, affected by GHSA-82fw-gwwq-j7x9 and GHSA-qxg6-89mg-rqv8; 4.1.11 is also affected by GHSA-xp26-3454-mjgp. Vitest 4 no longer uses tinypool, affected by GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr. The coverage provider must match vitest's version. |
| `@vitest/mocker` 4.1.12 | Storybook 9 pins 3.2.4, affected by the same vitest advisories. |
| `webpack-dev-middleware` 7.4.6 | Storybook's webpack builder asks for 6.x, affected by GHSA-g84c-rxfj-3j2c. |

The SDK depends on Storybook, but this plugin never runs it, so the last two only keep the lockfile clear.

## Release

1. Bump `version` in `package.json` and commit.
2. Push a matching tag, for example `v0.3.0`.

The release workflow checks the tag against `package.json`, runs the checks, and publishes `bitswalk-headlamp-k3d-<version>.tar.gz` with a `SHA256SUMS` file. It then commits `artifacthub/<version>/`, the Artifact Hub metadata that points at that archive, to `main`. Artifact Hub picks the new version up on its next scan, usually within 30 minutes.
