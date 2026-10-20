/** Sample Unsplash photos (free license) keyed by category, with SKU overrides. */
const BY_CATEGORY: Record<string, string> = {
  Brakes: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80',
  'Tyres & Tubes': 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=600&q=80',
  Electrical: 'https://images.unsplash.com/photo-1558981285-6f0c94958bb6?auto=format&fit=crop&w=600&q=80',
  Lighting: 'https://images.unsplash.com/photo-1591637333184-19aa84b3e01f?auto=format&fit=crop&w=600&q=80',
  'Body & Panels': 'https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=600&q=80',
  'Drive & Suspension': 'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&w=600&q=80',
  Charging: 'https://images.unsplash.com/photo-1593941707874-ef25b8b4a92b?auto=format&fit=crop&w=600&q=80',
  Accessories: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=600&q=80',
  Labour: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=600&q=80',
}

const BY_SKU: Record<string, string> = {
  'BRK-PAD-F': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80',
  'BRK-PAD-R': 'https://images.unsplash.com/photo-1558980664-2506fca6bfc2?auto=format&fit=crop&w=600&q=80',
  'BRK-DSC-F': 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=600&q=80',
  'TYR-90-90-17': 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=600&q=80',
  'TYR-275-17': 'https://images.unsplash.com/photo-1609630875171-b1321377ee65?auto=format&fit=crop&w=600&q=80',
  'TUB-17': 'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=600&q=80',
  'LGT-HEAD': 'https://images.unsplash.com/photo-1591637333184-19aa84b3e01f?auto=format&fit=crop&w=600&q=80',
  'LGT-TAIL': 'https://images.unsplash.com/photo-1611241893603-3c359704e0ee?auto=format&fit=crop&w=600&q=80',
  'ACC-HLM': 'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=600&q=80',
  'ACC-LOCK': 'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?auto=format&fit=crop&w=600&q=80',
  'ACC-PHN': 'https://images.unsplash.com/photo-1504222490345-c075b6008014?auto=format&fit=crop&w=600&q=80',
  'CHG-CHG': 'https://images.unsplash.com/photo-1593941707874-ef25b8b4a92b?auto=format&fit=crop&w=600&q=80',
  'DRV-SHK-R': 'https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&w=600&q=80',
  'BDY-SEAT': 'https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=600&q=80',
}

export function sampleImageFor(sku: string, categoryName?: string): string | undefined {
  return BY_SKU[sku] ?? (categoryName ? BY_CATEGORY[categoryName] : undefined)
}
