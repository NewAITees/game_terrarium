import { Box3,Object3D,Vector3, } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const assetCache = new Map<string, Promise<Object3D | null>>();

export function loadStructureAsset(path: string): Promise<Object3D | null> {
  if (!assetCache.has(path)) {
    const assetUrl = new URL(`../../${path}`, import.meta.url).href;
    assetCache.set(path, loader.loadAsync(assetUrl)
      .then((gltf: any) => gltf.scene ?? null)
      .catch((error: unknown) => {
        console.warn(`Failed to load structure asset: ${path}`, error);
        return null;
      }));
  }
  return assetCache.get(path)!;
}

export function normalizeAssetInstance(root: Object3D, targetSize: number): Object3D {
  const instance = root.clone(true);
  const box = new Box3().setFromObject(instance);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.0001);
  const scale = targetSize / largest;

  instance.position.sub(center);
  instance.scale.setScalar(scale);
  instance.traverse((node: any) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = false;
      if (node.material && !Array.isArray(node.material) && 'emissiveIntensity' in node.material) {
        node.material = node.material.clone();
        node.material.emissiveIntensity = Math.max(node.material.emissiveIntensity ?? 0, 0.18);
      }
    }
  });
  return instance;
}
