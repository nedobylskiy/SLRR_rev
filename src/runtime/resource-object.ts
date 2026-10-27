/** Native ResourceRef handle and its place in the resource tree. */
export class ResourceObject {
  readonly children = new Set<ResourceObject>();
  parent: ResourceObject | null = null;
  /** The ID exposed by ResourceRef.id(); zero means an unbound handle. */
  resourceId = 0;
  /** ResourceRef.type(); zero until a host resource has been created. */
  resourceType = 0;

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
