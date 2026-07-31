"use client";

import "@/app/styles/tailwind.css";
import "@/app/styles/drops-studio.dialogs.css";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  Cloud,
  Code2,
  Database,
  ExternalLink,
  LoaderCircle,
  LogOut,
  LockKeyhole,
  Rocket,
  Save,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { ProviderModelPicker } from "@/components/provider-model-picker";
import { TelegramChannelWizard } from "@/components/telegram-channel-wizard";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { getProjectPreset, type PresetId } from "@/lib/presets";
import {
  isModelProviderId,
  type ProviderModelCatalog,
} from "@/lib/provider-models";
import type { GeneratedProject } from "@/lib/project-types";
import {
  studioAccountDisplayName,
  studioAccountInitial,
} from "@/lib/studio-account-profile";

type ProviderId =
  | "free"
  | "dropstab"
  | "dropsbot"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "kimi"
  | "custom";

interface Provider {
  id: ProviderId;
  name: string;
  eyebrow: string;
  description: string;
  keyLabel?: string;
  docs?: string;
  endpoint?: boolean;
}

interface DropsStudioDialogsProps {
  connectionOpen: boolean;
  onConnectionOpenChange: (open: boolean) => void;
  projectsOpen: boolean;
  onProjectsOpenChange: (open: boolean) => void;
  providers: Provider[];
  provider: Provider;
  providerId: ProviderId;
  connections: Record<ProviderId, boolean>;
  providerKey: string;
  providerModel: string;
  providerModelCatalog: ProviderModelCatalog | null;
  customEndpoint: string;
  testingConnection: boolean;
  selectedId: PresetId;
  telegramProject: GeneratedProject | null;
  telegramProjectSlug: string | null;
  projects: GeneratedProject[];
  onSelectProvider: (id: ProviderId) => void;
  onProviderKeyChange: (value: string) => void;
  onProviderModelChange: (value: string) => void;
  onCustomEndpointChange: (value: string) => void;
  onConnectOpenRouter: () => void;
  memberConnected: boolean;
  accountProfile: {
    provider: "google" | "openrouter";
    name: string;
    email?: string;
    picture?: string;
  } | null;
  onSignInGoogle: () => void;
  onSignOut: () => void;
  projectSyncAvailable: boolean;
  onDisconnectOpenRouter: () => void;
  onConnectProvider: () => void;
  onOpenProject: (id: string) => void;
  onDeleteProject: (project: GeneratedProject) => Promise<void>;
  onDeleteAllProjects: () => Promise<void>;
}

export function DropsStudioDialogs({
  connectionOpen,
  onConnectionOpenChange,
  projectsOpen,
  onProjectsOpenChange,
  providers,
  provider,
  providerId,
  connections,
  providerKey,
  providerModel,
  providerModelCatalog,
  customEndpoint,
  testingConnection,
  selectedId,
  telegramProject,
  telegramProjectSlug,
  projects,
  onSelectProvider,
  onProviderKeyChange,
  onProviderModelChange,
  onCustomEndpointChange,
  onConnectOpenRouter,
  memberConnected,
  accountProfile,
  onSignInGoogle,
  onSignOut,
  projectSyncAvailable,
  onDisconnectOpenRouter,
  onConnectProvider,
  onOpenProject,
  onDeleteProject,
  onDeleteAllProjects,
}: DropsStudioDialogsProps) {
  const accountDisplayName = studioAccountDisplayName(accountProfile?.name);
  return (
    <>
      <Dialog
        open={connectionOpen}
        onOpenChange={onConnectionOpenChange}
      >
          <DialogContent
            className="connections-dialog"
            showCloseButton={false}
            overlayClassName="dialog-overlay"
          >
            <div className="dialog-top">
              <div>
                <DialogTitle>Connections Hub</DialogTitle>
                <DialogDescription>
                  Connect AI, DropsTab data, Telegram accounts and bots.
                  {accountProfile
                    ? " Verified credentials are encrypted for this account and never enter generated source, logs, exports or public projects."
                    : " Sensitive credentials stay in this browser session until you sign in, and are never compiled into public projects."}
                </DialogDescription>
              </div>
              <DialogClose
                className="dialog-close"
                aria-label="Close connections"
              >
                <X />
              </DialogClose>
            </div>
            <section className={`studio-account-card ${accountProfile ? "connected" : ""}`}>
              <span className="studio-account-avatar">
                {accountProfile
                  ? studioAccountInitial(accountProfile.name)
                  : <UserRound />}
              </span>
              <div>
                <strong>{accountProfile
                  ? accountDisplayName
                  : "Your Drops Studio profile"}</strong>
                <small>
                  {accountProfile?.email
                    ?? (accountProfile
                      ? "Private projects and encrypted connections sync to this account."
                      : "Sign in with Google to restore projects and verified connections on another device.")}
                </small>
              </div>
              <button
                type="button"
                onClick={accountProfile ? onSignOut : onSignInGoogle}
              >
                {accountProfile ? <LogOut /> : <UserRound />}
                {accountProfile ? "Sign out" : "Continue with Google"}
              </button>
            </section>
            <div className="connection-layout">
              <div className="provider-list">
                {providers.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={providerId === item.id ? "active" : ""}
                    onClick={() => onSelectProvider(item.id)}
                  >
                    <span>
                      {item.id === "free" ? (
                        <Sparkles />
                      ) : item.id === "dropstab" ? (
                        <Database />
                      ) : item.id === "dropsbot" ? (
                        <Bot />
                      ) : item.id === "custom" ? (
                        <Code2 />
                      ) : (
                        <Cloud />
                      )}
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.eyebrow}</small>
                    </div>
                    {connections[item.id] && (
                      <Check className="provider-check" />
                    )}
                  </button>
                ))}
              </div>
              <div
                className={`provider-detail ${provider.id === "dropsbot" ? "telegram-provider-detail" : ""}`}
              >
                {provider.id === "dropsbot" ? (
                  <TelegramChannelWizard
                    key={telegramProjectSlug ?? selectedId}
                    defaultTitle={
                      telegramProject?.spec.name ??
                      (selectedId === "morning-alpha"
                        ? "Morning Alpha"
                        : selectedId === "alpha-channel"
                          ? "My Alpha Channel"
                          : "My Drops Channel")
                    }
                    defaultAbout={
                      telegramProject?.spec.tagline ??
                      "Sourced crypto intelligence prepared in Drops Studio with DropsTab context."
                    }
                    defaultFirstPost={
                      telegramProject
                        ? `${telegramProject.spec.blueprint.content.headline}\n\n${telegramProject.spec.blueprint.content.subheadline}\n\nDraft prepared in Drops Studio. Verify live DropsTab context before publishing.`
                        : "Channel created with Drops Studio. DropsTab context is attributable; Drops Bot Profile linking remains separate setup."
                    }
                    projectContext={telegramProjectSlug ?? undefined}
                  />
                ) : (
                  <>
                    <span className="detail-icon">
                      {provider.id === "free" ? (
                        <Sparkles />
                      ) : provider.id === "dropstab" ? (
                        <Database />
                      ) : provider.id === "custom" ? (
                        <Code2 />
                      ) : (
                        <Cloud />
                      )}
                    </span>
                    <div className="detail-copy">
                      <span>{provider.eyebrow}</span>
                      <h3>{provider.name}</h3>
                      <p>{provider.description}</p>
                    </div>
                    {provider.id === "openrouter" && (
                      <div className="oauth-connect-card">
                        <div>
                          <BadgeCheck />
                          <span>
                            <strong>{connections.openrouter ? "OpenRouter connected" : "Connect OpenRouter in one click"}</strong>
                            <small>
                              {connections.openrouter
                                ? memberConnected
                                  ? "The credential is available to this tab and encrypted in your signed-in account vault."
                                  : "The credential is available only in this browser tab."
                                : "OpenRouter creates a user-controlled key for the models you choose."}
                            </small>
                          </span>
                        </div>
                        <button type="button" onClick={connections.openrouter ? onDisconnectOpenRouter : onConnectOpenRouter}>
                          {connections.openrouter ? "Disconnect OpenRouter" : "Continue with OpenRouter"} <ArrowRight size={15} />
                        </button>
                        <em>{connections.openrouter ? "Switch models below or return to Free Auto." : "or use an existing API key below"}</em>
                      </div>
                    )}
                    {provider.endpoint && (
                      <label className="key-field">
                        <span>HTTPS chat-completions endpoint</span>
                        <input
                          type="url"
                          value={customEndpoint}
                          onChange={(event) =>
                            onCustomEndpointChange(event.target.value)
                          }
                          placeholder="https://api.example.com/v1/chat/completions"
                        />
                      </label>
                    )}
                    {provider.keyLabel && (
                      <label className="key-field">
                        <span>{provider.keyLabel}</span>
                        <div>
                          <LockKeyhole size={16} />
                          <input
                            type="password"
                            autoComplete="off"
                            value={providerKey}
                            onChange={(event) =>
                              onProviderKeyChange(event.target.value)
                            }
                            placeholder="••••••••••••••••"
                          />
                        </div>
                      </label>
                    )}
                    {isModelProviderId(provider.id) ? (
                      <ProviderModelPicker
                        key={`${provider.id}:${providerModelCatalog?.verifiedAt ?? "unverified"}`}
                        catalog={providerModelCatalog}
                        providerName={provider.name}
                        selectedModel={providerModel}
                        onSelectModel={onProviderModelChange}
                      />
                    ) : provider.id === "custom" ? (
                      <label className="key-field">
                        <span>Model ID</span>
                        <input
                          type="text"
                          value={providerModel}
                          onChange={(event) =>
                            onProviderModelChange(event.target.value)
                          }
                          placeholder="Enter a model ID"
                        />
                      </label>
                    ) : null}
                    <div className="privacy-note">
                      <LockKeyhole size={15} />
                      <p>
                        <strong>{memberConnected ? "Encrypted account vault." : "Session-only storage."}</strong>{" "}
                        The key is never written to project files, logs, ZIPs or checkpoints.
                        {memberConnected
                          ? " After verification it is encrypted server-side and can be removed here."
                          : " Sign in to remember it across sessions."}
                        {provider.id === "custom"
                          ? " Custom requests go directly from your browser to the endpoint you choose."
                          : ""}
                      </p>
                    </div>
                    <div className="provider-detail-actions">
                      {provider.docs && (
                        <a
                          href={provider.docs}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open official docs <ExternalLink size={14} />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={onConnectProvider}
                        disabled={testingConnection}
                      >
                        {testingConnection ? (
                          <>
                            <LoaderCircle className="spin" /> Testing…
                          </>
                        ) : provider.id === "custom" ? (
                          <>
                            Save custom API <ArrowRight size={15} />
                          </>
                        ) : connections[provider.id] &&
                          isModelProviderId(provider.id) ? (
                          <>
                            Refresh verified models <BadgeCheck size={15} />
                          </>
                        ) : connections[provider.id] ? (
                          <>
                            Re-test connection <BadgeCheck size={15} />
                          </>
                        ) : isModelProviderId(provider.id) ? (
                          <>
                            Verify &amp; load models <ArrowRight size={15} />
                          </>
                        ) : (
                          <>
                            Connect & test <ArrowRight size={15} />
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </DialogContent>
      </Dialog>

      <Dialog open={projectsOpen} onOpenChange={onProjectsOpenChange}>
          <DialogContent
            className="projects-dialog"
            showCloseButton={false}
            overlayClassName="dialog-overlay"
          >
            <div className="dialog-top">
              <div>
                <DialogTitle>My Projects</DialogTitle>
                <DialogDescription>
                  {projectSyncAvailable
                    ? "Private account sync is active. Projects restore across sessions; runnable code is compiled safely in your browser."
                    : "Working products are saved in this browser. Sign in from Connections to enable private cross-session project sync."}
                </DialogDescription>
                <span className={`project-storage-status ${projectSyncAvailable ? "synced" : "local"}`}>
                  {projectSyncAvailable ? <Cloud /> : <Save />}
                  {projectSyncAvailable ? "Private cloud + browser" : "Browser storage"}
                </span>
              </div>
              <DialogClose
                className="dialog-close"
                aria-label="Close projects"
              >
                <X />
              </DialogClose>
            </div>
            {projects.length ? (
              <div className="project-list">
                {projects.map((project) => {
                  const projectPreset = getProjectPreset(project.spec.presetId);
                  return (
                    <div className="project-list-row" key={project.id}>
                      <button
                        className="project-open-button"
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                      >
                        <span>
                          <Save size={17} />
                        </span>
                        <div>
                          <strong>{project.spec.name}</strong>
                          <small>
                            {projectPreset?.output ?? "Live application"} ·{" "}
                            {project.publishedUrl ? "Published" : "Ready to run"}{" "}
                            · {new Date(project.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                        <ChevronRight />
                      </button>
                      <button
                        className="project-delete-button"
                        type="button"
                        aria-label={`Delete ${project.spec.name}`}
                        title={`Delete ${project.spec.name}`}
                        onClick={() => void onDeleteProject(project)}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  );
                })}
                <button
                  className="delete-all-projects"
                  type="button"
                  onClick={() => void onDeleteAllProjects()}
                >
                  <Trash2 /> Delete all projects
                </button>
              </div>
            ) : (
              <div className="empty-projects">
                <Rocket />
                <strong>No projects yet</strong>
                <p>
                  Pick a recipe, tune the settings and compile your first
                  working product.
                </p>
              </div>
            )}
          </DialogContent>
      </Dialog>
    </>
  );
}
