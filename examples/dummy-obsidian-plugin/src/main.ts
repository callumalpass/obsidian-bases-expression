import { ItemView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import {
  BasesExpressionBuilder,
  openBasesExpressionBuilder,
  collectObsidianBasesSchema,
  type BasesExpressionBuilderChange,
} from "obsidian-bases-expression-builder";

const VIEW_TYPE = "bases-expression-builder-smoke-view";

declare global {
  interface Window {
    __obeBuilderSmoke?: {
      loaded: boolean;
      schemaPropertyCount: number;
      lastSource: string;
      lastValid: boolean;
      lastFilter: unknown;
    };
  }
}

export default class BasesExpressionBuilderSmokePlugin extends Plugin {
  override async onload(): Promise<void> {
    window.__obeBuilderSmoke = {
      loaded: true,
      schemaPropertyCount: 0,
      lastSource: "",
      lastValid: false,
      lastFilter: null,
    };

    this.registerView(VIEW_TYPE, (leaf) => new BuilderSmokeView(leaf, this));

    this.addCommand({
      id: "open-builder-modal",
      name: "Open Bases expression builder modal",
      callback: () => this.openModal(),
    });

    this.addCommand({
      id: "open-builder-view",
      name: "Open Bases expression builder view",
      callback: () => this.activateView(),
    });

    this.addRibbonIcon("list-filter", "Bases expression builder smoke", () => {
      void this.activateView();
    });
  }

  openModal(): void {
    const schema = collectObsidianBasesSchema(this.app);
    window.__obeBuilderSmoke = {
      loaded: true,
      schemaPropertyCount: schema.properties?.length ?? 0,
      lastSource: "",
      lastValid: false,
      lastFilter: null,
    };
    openBasesExpressionBuilder(this.app, {
      schema,
      initialExpression: 'status == "Todo"',
      autofocus: true,
      onChange: (change) => this.recordChange(change, schema.properties?.length ?? 0),
      onApply: (change) => {
        this.recordChange(change, schema.properties?.length ?? 0);
        new Notice(`Expression: ${change.source}`);
      },
    });
  }

  async activateView(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("No workspace leaf available for builder smoke view");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  recordChange(change: BasesExpressionBuilderChange, schemaPropertyCount: number): void {
    window.__obeBuilderSmoke = {
      loaded: true,
      schemaPropertyCount,
      lastSource: change.source,
      lastValid: change.validation.valid,
      lastFilter: change.filter,
    };
  }
}

class BuilderSmokeView extends ItemView {
  private readonly plugin: BasesExpressionBuilderSmokePlugin;
  private builder: BasesExpressionBuilder | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: BasesExpressionBuilderSmokePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  override getViewType(): string {
    return VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Bases expression builder";
  }

  override getIcon(): string {
    return "list-filter";
  }

  override async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.replaceChildren();
    container.classList.add("obe-builder-smoke-view");

    const headerEl = document.createElement("div");
    headerEl.className = "view-header-title-container obe-builder-smoke-header";
    const titleEl = document.createElement("div");
    titleEl.className = "view-header-title";
    titleEl.textContent = "Bases expression builder";
    headerEl.appendChild(titleEl);
    container.appendChild(headerEl);

    const hostEl = document.createElement("div");
    hostEl.className = "obe-builder-smoke-host";
    container.appendChild(hostEl);

    const schema = collectObsidianBasesSchema(this.app);
    this.builder = new BasesExpressionBuilder({
      app: this.app,
      schema,
      initialExpression: 'status == "Todo"',
      autofocus: true,
      onChange: (change) => this.plugin.recordChange(change, schema.properties?.length ?? 0),
      onApply: (change) => {
        this.plugin.recordChange(change, schema.properties?.length ?? 0);
        new Notice(`Expression: ${change.source}`);
      },
    });
    this.builder.mount(hostEl);
  }

  override async onClose(): Promise<void> {
    this.builder?.destroy();
    this.builder = null;
  }
}
