/**
 * The plugin's whole contract with the laptop: three k3d invocations.
 *
 * Each one matches a `runCommands` grant in the product's app-build-manifest.json.
 * No other module may call `pluginRunCommand`, and nothing here builds argv from
 * free-form input: create and delete each append exactly one validated argument.
 */
// Headlamp main's PluginRunCommand. @kinvolk/headlamp-plugin 0.14.0 neither exports
// it nor types runCommand for tools other than minikube, az and scriptjs.
type PluginRunCommand = (
  tool: string,
  args: string[],
  options: Record<string, never>
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
export const CREATE_PREFIX = ['cluster', 'create', '--config'];
export const DELETE_PREFIX = ['cluster', 'delete'];

// Exit codes Headlamp's main process reports when no k3d process ran.
const SPAWN_FAILED = -1;
const NOT_AUTHORIZED = -2;
const CONSENT_DENIED = -3;

// The desktop product this plugin ships in, named in messages to the operator.
const APP_NAME = 'k3dlamp';

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
  | { state: 'unavailable'; reason: string };

/** Whether this Headlamp build granted the plugin its k3d commands. */
export function commandsGranted(): boolean {
  return typeof pluginRunCommand === 'function';
}

function run(args: string[], onOutput?: (chunk: string) => void): Promise<RunResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    const proc = pluginRunCommand(K3D, args, {});
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
      return /ENOENT/.test(stderr)
        ? `k3d is not installed, or not on the PATH ${APP_NAME} was started with.`
        : `k3d could not be started: ${stderr.trim() || 'unknown error'}`;
    case NOT_AUTHORIZED:
      return `This ${APP_NAME} build does not grant the plugin this k3d command.`;
    case CONSENT_DENIED:
      return `The k3d command was denied in the consent prompt. ${APP_NAME} keeps that choice.`;
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
    return {
      state: 'unavailable',
      reason: `This ${APP_NAME} build does not grant the plugin any k3d command.`,
    };
  }
  const result = await run(LIST_ARGS);
  if (result.code !== 0) {
    return { state: 'unavailable', reason: describeFailure(result) };
  }
  try {
    return { state: 'ready', clusters: parseClusterList(result.stdout) };
  } catch (err) {
    return { state: 'unavailable', reason: `Unexpected k3d output: ${(err as Error).message}` };
  }
}

export function validateConfigPath(path: string): string | null {
  if (path.trim() === '') {
    return 'Enter the path of a k3d config file.';
  }
  if (path !== path.trim()) {
    return 'The path must not start or end with spaces.';
  }
  if (path.startsWith('-')) {
    return 'The path must not start with "-".';
  }
  return null;
}

export function createCluster(
  configPath: string,
  onOutput: (chunk: string) => void
): Promise<RunResult> {
  const invalid = validateConfigPath(configPath);
  if (invalid) {
    throw new Error(invalid);
  }
  return run([...CREATE_PREFIX, configPath], onOutput);
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
