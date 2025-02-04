import { unmanaged } from "inversify";
import { provide } from "inversify-binding-decorators";
import * as path from "path";
import {
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
} from "vscode";
import { GraphMetaMap, Model, Node, Snapshot, Source, Test } from "../domain";
import { DBTProjectContainer } from "../manifest/dbtProjectContainer";
import {
  ManifestCacheChangedEvent,
  ManifestCacheProjectAddedEvent,
} from "../manifest/event/manifestCacheChangedEvent";
import { provideSingleton } from "../utils";

@provide(ModelTreeviewProvider)
abstract class ModelTreeviewProvider
  implements TreeDataProvider<NodeTreeItem>, Disposable
{
  private eventMap: Map<string, ManifestCacheProjectAddedEvent> = new Map();
  private _onDidChangeTreeData: EventEmitter<ModelTreeItem | undefined | void> =
    new EventEmitter<ModelTreeItem | undefined | void>();
  readonly onDidChangeTreeData: Event<ModelTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;
  private disposables: Disposable[] = [this._onDidChangeTreeData];

  constructor(
    private dbtProjectContainer: DBTProjectContainer,
    @unmanaged() private treeType: keyof GraphMetaMap
  ) {
    this.treeType = treeType;
    this.disposables.push(
      window.onDidChangeActiveTextEditor(() => {
        this._onDidChangeTreeData.fire();
      }),
      this.dbtProjectContainer.onManifestChanged((event) =>
        this.onManifestCacheChanged(event)
      )
    );
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private onManifestCacheChanged(event: ManifestCacheChangedEvent): void {
    event.added?.forEach((added) => {
      this.eventMap.set(added.projectRoot.fsPath, added);
    });
    event.removed?.forEach((removed) => {
      this.eventMap.delete(removed.projectRoot.fsPath);
    });
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: NodeTreeItem): NodeTreeItem | Thenable<ModelTreeItem> {
    return element;
  }

  getChildren(element?: NodeTreeItem): Thenable<NodeTreeItem[]> {
    if (window.activeTextEditor === undefined || this.eventMap === undefined) {
      return Promise.resolve([]);
    }

    const currentFilePath = window.activeTextEditor.document.uri;
    const projectRootpath =
      this.dbtProjectContainer.getProjectRootpath(currentFilePath);
    if (projectRootpath === undefined) {
      return Promise.resolve([]);
    }

    const event = this.eventMap.get(projectRootpath.fsPath);
    if (event === undefined) {
      return Promise.resolve([]);
    }

    if (element?.key.startsWith("test.")) {
      return Promise.resolve([]);
    }

    if (element) {
      return Promise.resolve(this.getTreeItems(element.key, event));
    }

    const { projectName } = event;
    const fileName = path.basename(
      window.activeTextEditor!.document.fileName,
      ".sql"
    );
    const packageName =
      this.dbtProjectContainer.getPackageName(currentFilePath) || projectName;
    return Promise.resolve(
      this.getTreeItems(`model.${packageName}.${fileName}`, event)
    );
  }

  private getTreeItems(
    elementName: string,
    event: ManifestCacheProjectAddedEvent
  ): NodeTreeItem[] {
    const { graphMetaMap } = event;
    const parentModels = graphMetaMap[this.treeType].get(elementName);
    if (parentModels === undefined) {
      return [];
    }
    return parentModels.nodes
      .filter((node) => node.displayInModelTree)
      .map((node) => {
        const childNodes = graphMetaMap[this.treeType]
          .get(node.key)
          ?.nodes.filter((node) => node.displayInModelTree);

        if (
          (node instanceof Model || node instanceof Snapshot) &&
          childNodes?.filter(
            (node) => node instanceof Model || node instanceof Snapshot
          ).length === 0
        ) {
          return new DashboardTreeItem(node);
        }
        if (node instanceof Test) {
          return new TestTreeItem(node);
        }
        if (node instanceof Source) {
          return new SourceTreeItem(node);
        }
        return new ModelTreeItem(node);
      });
  }
}

export class NodeTreeItem extends TreeItem {
  collapsibleState = TreeItemCollapsibleState.Collapsed;
  key: string;
  url: string;

  constructor(node: Node) {
    super(node.label);
    this.key = node.key;
    this.url = node.url;
    if (node.iconPath !== undefined) {
      this.iconPath = node.iconPath;
    }
    this.command = {
      command: "vscode.open",
      title: "Select Node",
      arguments: [Uri.file(node.url)],
    };
  }
}

class ModelTreeItem extends NodeTreeItem {
  contextValue = "model";
}

class SourceTreeItem extends NodeTreeItem {
  collapsibleState = TreeItemCollapsibleState.None;
  contextValue = "source";
}

class TestTreeItem extends NodeTreeItem {
  collapsibleState = TreeItemCollapsibleState.None;
  iconPath = {
    light: path.join(
      path.resolve(__dirname),
      "../media/images/dashboard_light.svg"
    ),
    dark: path.join(
      path.resolve(__dirname),
      "../media/images/dashboard_dark.svg"
    ),
  };
  contextValue = "dashboard";
}

class DashboardTreeItem extends NodeTreeItem {
  collapsibleState = TreeItemCollapsibleState.None;
  iconPath = {
    light: path.join(
      path.resolve(__dirname),
      "../media/images/dashboard_light.svg"
    ),
    dark: path.join(
      path.resolve(__dirname),
      "../media/images/dashboard_dark.svg"
    ),
  };
  contextValue = "dashboard";
}

@provideSingleton(ModelTestTreeview)
export class ModelTestTreeview extends ModelTreeviewProvider {
  constructor(dbtProjectContainer: DBTProjectContainer) {
    super(dbtProjectContainer, "tests");
  }
}

@provideSingleton(ParentModelTreeview)
export class ParentModelTreeview extends ModelTreeviewProvider {
  constructor(dbtProjectContainer: DBTProjectContainer) {
    super(dbtProjectContainer, "parents");
  }
}

@provideSingleton(ChildrenModelTreeview)
export class ChildrenModelTreeview extends ModelTreeviewProvider {
  constructor(dbtProjectContainer: DBTProjectContainer) {
    super(dbtProjectContainer, "children");
  }
}
