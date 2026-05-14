export function ensureLiveRegion() {
  let region = document.getElementById('a11y-live-region');
  if (region) return region;
  region = document.createElement('div');
  region.id = 'a11y-live-region';
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.style.position = 'fixed';
  region.style.width = '1px';
  region.style.height = '1px';
  region.style.overflow = 'hidden';
  region.style.clipPath = 'inset(50%)';
  document.body.appendChild(region);
  return region;
}

export function announce(message) {
  const region = ensureLiveRegion();
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}
