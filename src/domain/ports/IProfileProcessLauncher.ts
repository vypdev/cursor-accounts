/** Input required to launch a Cursor process. */
export interface ProfileProcessLaunchRequest {
  executablePath: string;
  args: string[];
  caCertPath?: string;
  appBundlePath?: string;
}

/** Port for launching Cursor outside the extension host. */
export interface IProfileProcessLauncher {
  launch(request: ProfileProcessLaunchRequest): Promise<void>;
}
