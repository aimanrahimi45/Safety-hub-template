/** Unified collapsible-section helpers — imported by any page that
 *  renders grouped question/response sections client-side.
 */

/** Toggle a single collapsible section on click. */
export function toggleCollapsibleSection(section: HTMLElement): void {
  const collapsed = section.classList.toggle('ins-section-collapsed');
  const arrow = section.querySelector<HTMLElement>('.ins-section-arrow');
  if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
}

/** Expand or collapse every section inside `container`. */
export function setAllSections(
  container: HTMLElement,
  expanded: boolean,
): void {
  container.querySelectorAll<HTMLElement>('.ins-category-section').forEach((sec) => {
    if (expanded) {
      sec.classList.remove('ins-section-collapsed');
    } else {
      sec.classList.add('ins-section-collapsed');
    }
    const arrow = sec.querySelector<HTMLElement>('.ins-section-arrow');
    if (arrow) arrow.textContent = expanded ? '▼' : '▶';
  });
}

/** Initialize click-to-toggle on every section header inside `container`. */
export function initCollapsibleSections(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.ins-category-title').forEach((title) => {
    title.addEventListener('click', () => {
      const section = title.closest<HTMLElement>('.ins-category-section');
      if (section) toggleCollapsibleSection(section);
    });
  });
}
