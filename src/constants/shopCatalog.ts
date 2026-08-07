export type ItemType = 'consumable' | 'multiplier' | 'minigame_boost' | 'cosmetic';

export interface ShopItem {
  id: string;
  title: string;
  description: string;
  price: number;
  type: ItemType;
  metadata?: any;
}

export const SHOP_ITEMS: ShopItem[] = [
  {
  id: 'cafe_biblio',
  title: 'Café de la Biblio',
  description: 'Protector de racha de 1 día.',
  price: 20,
  type: 'temporal' // <--- Clave para que se sepa que dura solo 24 horas
  },

  {
    id: 'multiplicador_24h',
    title: '⚡ Multiplicador 24h',
    description: 'Duplica tus monedas ganadas por 24h.',
    price: 50,
    type: 'temporal',
    metadata: { multiplier: 2, duration_hours: 24 }
  },
  {
    id: 'ruleta_extra',
    title: '🎲 Intento Extra',
    description: 'Un intento más en la ruleta diaria.',
    price: 15,
    type: 'consumible'
  },
  {
    id: 'badge_legend',
    title: '🏷️ Estudiante Legendario',
    description: 'Insignia exclusiva para tu perfil.',
    price: 100,
    type: 'permanente'
  }
];