# k3dlamp k3d plugin

A Headlamp Desktop plugin that creates and deletes k3d clusters. It ships inside [k3dlamp](https://github.com/bitswalk/k3dlamp).

The plugin checks that k3d works, lists its clusters, creates a cluster from a k3d config file, and deletes one. k3d adds each new cluster to the default kubeconfig. Headlamp watches that file, so the cluster appears in Headlamp's cluster list as `k3d-<name>`.

## Command grants

Headlamp lets a plugin run a local command only when the product's `app-build-manifest.json` grants it. This plugin needs the three grants in [`command-grants.json`](command-grants.json):

| Invocation | Match | Plugin use |
| --- | --- | --- |
| `k3d cluster list -o json` | Exact | Checks that k3d runs and lists clusters |
| `k3d cluster create --config <path>` | Prefix | Creates a cluster from a config file |
| `k3d cluster delete <name>` | Prefix | Deletes a cluster |

The plugin appends exactly one argument to `create` and to `delete`. It rejects a path or name that starts with `-`, so `--all` and extra flags can't get through. `src/k3d.ts` is the only module that runs a command, and a unit test fails if its argv drifts from `command-grants.json`.

Grants are matched against the plugin's identity: package `@bitswalk/headlamp-k3d`, bundle directory `headlamp-k3d`.

The feature needs Headlamp built from `main` after v0.45.0. The plugin builds against `@kinvolk/headlamp-plugin` 0.14.0, which predates the `PluginRunCommand` type, so `k3d.ts` declares that type itself.

## What it reports

| Situation | Message |
| --- | --- |
| The build doesn't grant k3d, or this is a browser deployment | "This Headlamp build does not grant the plugin any k3d command." |
| `k3d` isn't on `PATH` | "k3d is not installed, or not on the PATH Headlamp was started with." |
| Consent was denied | "The k3d command was denied in the consent prompt. Headlamp keeps that choice." |
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

## Release

1. Bump `version` in `package.json` and commit.
2. Push a matching tag, for example `v0.2.0`.

The release workflow checks the tag against `package.json`, runs the checks, and publishes `bitswalk-headlamp-k3d-<version>.tar.gz` with a `SHA256SUMS` file. k3dlamp then pins the release with its `scripts/update-plugin.sh`.
