/** Native ResourceRef handle and its place in the resource tree. */
export class ResourceObject {
  readonly children = new Set<ResourceObject>();
  parent: ResourceObject | null = null;
  /** The ID exposed by ResourceRef.id(); zero means an unbound handle. */
  resourceId = 0;
  /** Owning RPK for a type reference; absent for transient engine objects. */
  resourcePack: string | null = null;
  resourceScript: string | null = null;
  /** ResourceRef.type(); zero until a host resource has been created. */
  resourceType = 0;
  /** Source resource ID when this binding was duplicated as an independent resource. */
  copiedFromResourceId: number | null = null;
  readonly resourceReplacements = new Map<number, number>();
  meshScale = { x: 1, y: 1, z: 1 };

  constructor(readonly id: number, readonly className: string, public typeId = 0,
    public params: string | null = null, public alias = className.split('.').at(-1)!) {}

  get parentId(): number | null { return this.parent?.resourceId ?? null; }

  setParent(next: ResourceObject | null): void {
    for (let current = next; current; current = current.parent)
      if (current === this) throw new Error('Resource object parent cycle');
    if (this.parent === next) return;
    this.parent?.children.delete(this);
    this.parent = next;
    next?.children.add(this);
  }
}
