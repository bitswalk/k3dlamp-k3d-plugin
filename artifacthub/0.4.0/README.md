# k3dlamp k3d plugin

[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/bitswalk-k3dlamp-k3d-plugin)](https://artifacthub.io/packages/search?repo=bitswalk-k3dlamp-k3d-plugin)

A Headlamp Desktop plugin that creates and deletes k3d clusters. It is built for [k3dlamp](https://github.com/bitswalk/k3dlamp) and published on [Artifact Hub](https://artifacthub.io/packages/headlamp/bitswalk-k3dlamp-k3d-plugin/k3dlamp-k3d-plugin).

The plugin checks that k3d works, lists its clusters, creates clusters, and deletes them. It lists them as Headlamp's home page lists clusters: origin, status, warnings and Kubernetes version, with **Delete** in each row's **Actions** menu. k3d adds each new cluster to the default kubeconfig. Headlamp watches that file, so the cluster appears in the cluster list as `k3d-<name>`.

Its **k3d** page, also reached from **Add Cluster → Providers → k3d**, creates a cluster two ways:

- **Add cluster** creates a cluster with one k3s server and no agents, named `local-aio`, or `local-aio-2` and so on if that name is taken.
- **Custom cluster**, at the top right, opens an editor on that same config. Edit it or upload a k3d config file, then click **Create**. The editor keeps the draft until a create from it succeeds, so **Edit config** on a failure reopens it as it was.

## Requirements

**This plugin works only in a Headlamp desktop build whose `app-build-manifest.json` grants it three k3d commands, and that passes standard input to them.** Headlamp runs a plugin's local commands only when the build's manifest grants them, and stock Headlamp releases grant none to this plugin. Installed there, the plugin shows a notice listing the missing grants instead of the k3d page.

k3dlamp is a Headlamp build with these grants. To use the plugin in your own build, you need:

- Headlamp v0.46.0 or later, the first release with the `runCommands` manifest field, with k3dlamp's [`0004-run-command-input.patch`](https://github.com/bitswalk/k3dlamp/blob/main/patches/0004-run-command-input.patch). Stock Headlamp passes a plugin's command no standard input, which is how the plugin hands k3d a cluster config. k3dlamp 0.4.0 and later carry it.
- Docker and [k3d](https://k3d.io) on the `PATH` the app starts with.
- A `runCommands` policy that names this plugin and grants the commands in [`command-grants.json`](command-grants.json).

| Invocation | Match | Plugin use |
| --- | --- | --- |
| `k3d cluster list -o json` | Exact | Checks that k3d runs and lists clusters |
| `k3d cluster create --config -` | Exact | Creates a cluster from the config it sends on standard input |
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
      "artifactHubPackage": "bitswalk-k3dlamp-k3d-plugin/k3dlamp-k3d-plugin"
    }
  ],
  "commands": [
    { "tool": "k3d", "args": ["cluster", "list", "-o", "json"] },
    { "tool": "k3d", "args": ["cluster", "create", "--config", "-"] },
    { "tool": "k3d", "args": ["cluster", "delete"], "allowTrailingArgs": true }
  ]
}
```

Headlamp's [command capabilities guide](https://headlamp.dev/docs/latest/development/plugins/command-capabilities) recommends also pinning `artifactHubPackageId` and `artifactHubRepositoryId`; [k3dlamp's manifest](https://github.com/bitswalk/k3dlamp/blob/main/app-build-manifest.json) shows them. A policy for the `user` location can't pre-approve commands, so Headlamp asks for consent the first time each of the three runs, and remembers the answer.

The plugin sends `create` exactly as granted, with the config on standard input, and appends exactly one argument to `delete`: a cluster name, checked against k3d's naming rules, so `--all` and extra flags can't get through. A config is any text up to 1 MiB, the most k3dlamp passes; k3d checks it. `src/k3d.ts` is the only module that runs a command, and a unit test fails if its argv drifts from `command-grants.json`.

The plugin builds against `@kinvolk/headlamp-plugin` 0.14.0, which predates the `PluginRunCommand` type, so `k3d.ts` declares that type itself.

## What it reports

| Situation | What the k3d page shows |
| --- | --- |
| The build grants no k3d command, or this is a browser deployment | A notice listing the three grants it needs |
| `k3d` isn't on `PATH` | "k3d is not installed, or not on the PATH this app was started with." |
| The build can't pass standard input, such as k3dlamp before 0.4.0 | "This app can't pass a config to k3d. Update k3dlamp to 0.4.0 or later." |
| Consent was denied | "The k3d command was denied in the consent prompt, and the app keeps that choice." |
| k3d fails, for example Docker is down | k3d's own stderr |
| k3d has a cluster that the kubeconfig has no context for | The cluster's status is "Not in kubeconfig", and its tooltip gives the `k3d kubeconfig merge` command that adds it back |
| k3d reports none of a cluster's servers running, as after `k3d cluster stop` | The cluster's status is "Stopped", and its tooltip gives the `k3d cluster start` command |

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

`elliptic` has no override because no release fixes GHSA-848j-6mx2-7j84. It comes from `vite-plugin-node-polyfills` through `node-stdlib-browser` and `crypto-browserify`. The SDK's build only enables the `process`, `buffer` and `stream` polyfills, and this plugin never imports `crypto`, so `elliptic` is not in `dist/main.js`.

## Release

1. Bump `version` in `package.json` and commit.
2. Push a matching tag, for example `v0.3.0`.

The release workflow checks the tag against `package.json`, runs the checks, and publishes `bitswalk-headlamp-k3d-<version>.tar.gz` with a `SHA256SUMS` file. It then commits `artifacthub/<version>/`, the Artifact Hub metadata that points at that archive, to `main`. Artifact Hub picks the new version up on its next scan, usually within 30 minutes.
