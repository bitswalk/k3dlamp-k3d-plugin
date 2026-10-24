/**
 * The plugin's whole contract with the laptop: three k3d invocations.
 *
 * Headlamp runs them only in a desktop build whose app-build-manifest.json grants
 * each one to this plugin in `runCommands`; stock Headlamp releases grant none.
 * No other module may call `pluginRunCommand`, and nothing here builds argv from
 * free-form input: create sends its config on standard input, and delete appends
 * exactly one validated name.
 */
// Headlamp v0.46.0's PluginRunCommand, with the `input` option k3dlamp 0.4.0 adds.
// @kinvolk/headlamp-plugin 0.14.0 neither exports it nor types runCommand for tools
// other than minikube, az and scriptjs.
type PluginRunCommand = (
  tool: string,
  args: string[],
  options: { input?: string }
) => {
  stdout: { on: (event: 'data', listener: (chunk: string) => void) => void };
  stderr: { on: (event: 'data', listener: (chunk: string) => void) => void };
  on: (event: 'exit', listener: (code: number | null) => void) => void;
};

// Injected by Headlamp only when the product manifest grants this plugin k3d.
// It is a free identifier, so it must be probed with `typeof` before use.
declare const pluginRunCommand: PluginRunCommand;

export const K3D = 'k3d';
export const LIST_ARGS = ['cluster', 'list', '-o', 'json'];
// k3d reads the config from standard input when the path is "-".
export const CREATE_ARGS = ['cluster', 'create', '--config', '-'];
export const DELETE_PREFIX = ['cluster', 'delete'];

/** The invocations a build must grant, as an operator would type them. */
export const REQUIRED_COMMANDS = [
  [K3D, ...LIST_ARGS].join(' '),
  [K3D, ...CREATE_ARGS].join(' '),
  [K3D, ...DELETE_PREFIX, '<name>'].join(' '),
];

/** The most standard input k3dlamp passes to a command, in UTF-16 code units. */
export const MAX_CONFIG_LENGTH = 1024 * 1024;

/** What Add cluster names its first cluster: everything in one k3s server. */
export const DEFAULT_CLUSTER_NAME = 'local-aio';

/** Where the README explains the grants, for builds that lack them. */
export const GRANTS_URL = 'https://github.com/bitswalk/k3dlamp-k3d-plugin#requirements';

// Exit codes Headlamp's main process reports when no k3d process ran.
const SPAWN_FAILED = -1;
const NOT_AUTHORIZED = -2;
const CONSENT_DENIED = -3;

// k3d prefixes kubeconfig contexts with "k3d-".
const CONTEXT_PREFIX = 'k3d-';

// RFC 1123 label: what k3d accepts as a cluster name, and never a flag.
const CLUSTER_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// k3d colours its log lines even when its output is not a terminal.
// eslint-disable-next-line no-control-regex
const ANSI_COLOUR = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_COLOUR, '');
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface K3dCluster {
  name: string;
  serversRunning: number;
  serversCount: number;
  agentsRunning: number;
  agentsCount: number;
}

export type K3dStatus =
  | { state: 'ready'; clusters: K3dCluster[] }
  // This build's manifest doesn't grant the plugin its k3d commands.
  | { state: 'ungranted' }
  | { state: 'unavailable'; reason: string };

/** Whether this build granted the plugin any of its k3d commands. */
export function commandsGranted(): boolean {
  return typeof pluginRunCommand === 'function';
}

function run(
  args: string[],
  onOutput?: (chunk: string) => void,
  input?: string
): Promise<RunResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    const proc = pluginRunCommand(K3D, args, input === undefined ? {} : { input });
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      onOutput?.(chunk);
    });
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      onOutput?.(chunk);
    });
    proc.on('exit', code =>
      resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) })
    );
  });
}

/** Turns a failed invocation into a sentence an operator can act on. */
export function describeFailure({ code, stderr }: RunResult): string {
  switch (code) {
    case SPAWN_FAILED:
      // The app refused the request before starting k3d. The only request it
      // refuses this way is one with standard input, from a build older than
      // k3dlamp 0.4.0.
      if (stderr.trim() === '') {
        return "This app can't pass a config to k3d. Update k3dlamp to 0.4.0 or later.";
      }
      return /ENOENT/.test(stderr)
        ? 'k3d is not installed, or not on the PATH this app was started with.'
        : `k3d could not be started: ${stderr.trim()}`;
    case NOT_AUTHORIZED:
      return `This build's app-build-manifest.json does not grant the plugin this k3d command. See ${GRANTS_URL}`;
    case CONSENT_DENIED:
      return 'The k3d command was denied in the consent prompt, and the app keeps that choice.';
    default:
      return stderr.trim() || `k3d exited with code ${code}.`;
  }
}

export function parseClusterList(stdout: string): K3dCluster[] {
  const entries: unknown = JSON.parse(stdout);
  if (!Array.isArray(entries)) {
    throw new Error('k3d cluster list did not return a JSON array');
  }
  // Pick fields one by one: the raw entries also carry each cluster's join token.
  return entries.map(entry => ({
    name: String(entry.name),
    serversRunning: Number(entry.serversRunning) || 0,
    serversCount: Number(entry.serversCount) || 0,
    agentsRunning: Number(entry.agentsRunning) || 0,
    agentsCount: Number(entry.agentsCount) || 0,
  }));
}

/**
 * Checks that k3d can be run and lists its clusters. The list doubles as the
 * installation check, so the plugin needs no `k3d version` grant.
 */
export async function probe(): Promise<K3dStatus> {
  if (!commandsGranted()) {
    return { state: 'ungranted' };
  }
  const result = await run(LIST_ARGS);
  if (result.code === NOT_AUTHORIZED) {
    return { state: 'ungranted' };
  }
  if (result.code !== 0) {
    return { state: 'unavailable', reason: describeFailure(result) };
  }
  try {
    return { state: 'ready', clusters: parseClusterList(result.stdout) };
  } catch (err) {
    return { state: 'unavailable', reason: `Unexpected k3d output: ${(err as Error).message}` };
  }
}

/** A k3d.io/v1alpha5 Simple config for one k3s server that Headlamp picks up. */
export function defaultConfig(name: string): string {
  return `# Everything in one k3s server, on k3d's default bridge network.
# Reference: https://k3d.io/stable/usage/configfile/
apiVersion: k3d.io/v1alpha5
kind: Simple
metadata:
  name: ${name} # Headlamp shows it as ${contextName(name)}
servers: 1
agents: 0
options:
  k3d:
    wait: true
    timeout: "300s"
  kubeconfig:
    updateDefaultKubeconfig: true # Headlamp picks the new context up from here
    switchCurrentContext: false
`;
}

/** The default cluster name, or the first local-aio-<n> that no cluster has yet. */
export function nextClusterName(taken: string[]): string {
  const names = new Set(taken);
  let name = DEFAULT_CLUSTER_NAME;
  for (let n = 2; names.has(name); n++) {
    name = `${DEFAULT_CLUSTER_NAME}-${n}`;
  }
  return name;
}

export function validateConfig(config: string): string | null {
  if (config.trim() === '') {
    return 'The config is empty.';
  }
  if (config.length > MAX_CONFIG_LENGTH) {
    return 'The config is larger than 1 MiB.';
  }
  return null;
}

/** Creates a cluster from a k3d config, which k3d reads on standard input. */
export function createCluster(
  config: string,
  onOutput: (chunk: string) => void
): Promise<RunResult> {
  const invalid = validateConfig(config);
  if (invalid) {
    throw new Error(invalid);
  }
  return run(CREATE_ARGS, onOutput, config);
}

export function deleteCluster(name: string, onOutput: (chunk: string) => void): Promise<RunResult> {
  if (!CLUSTER_NAME.test(name)) {
    throw new Error(`Not a k3d cluster name: ${name}`);
  }
  return run([...DELETE_PREFIX, name], onOutput);
}

/** The kubeconfig context, and so the Headlamp cluster, k3d creates for a cluster. */
export function contextName(clusterName: string): string {
  return CONTEXT_PREFIX + clusterName;
}

/** The k3d cluster behind a Headlamp cluster, if its context follows k3d's naming. */
export function clusterNameFromContext(context: string): string | null {
  if (!context.startsWith(CONTEXT_PREFIX)) {
    return null;
  }
  const name = context.slice(CONTEXT_PREFIX.length);
  return CLUSTER_NAME.test(name) ? name : null;
}
