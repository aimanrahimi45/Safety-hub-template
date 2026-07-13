// =====================================================================
// Default first-aid inventory seed list.
//
// Mirrors the 23 default items initialised by the GAS backend
// (initializeFirstAidSheets in Safety_Hub_Backend.js, lines 243-266).
// Used by the "Seed default 23 items" button on the inventory page
// when a tenant has an empty first_aid_inventory table.
//
// RLS note: the user must be authenticated and own a tenant. RLS
// automatically writes tenant_id on INSERT; the caller passes
// { tenant_id, ... } through supabase.from('first_aid_inventory')
// .insert() and the policy fills it in via WITH CHECK.
// =====================================================================

export interface DefaultFirstAidItem {
  item_code: string;
  item_name: string;
  unit: string;
  current_stock: number;
  min_alert_level: number;
  required_std: string;
  category_group: number;
}

export const DEFAULT_FIRST_AID_ITEMS: ReadonlyArray<DefaultFirstAidItem> = [
  { item_code: 'FA-01', item_name: 'Triangular Bandage 100cm', unit: 'pcs',  current_stock: 0, min_alert_level: 10, required_std: '5pcs',  category_group: 1 },
  { item_code: 'FA-02', item_name: 'Eye Dressing No 16',        unit: 'pkt',  current_stock: 0, min_alert_level: 5,  required_std: '3pkt',  category_group: 1 },
  { item_code: 'FA-03', item_name: 'Sterile Gamgee Pad 25cm',    unit: 'pkt',  current_stock: 0, min_alert_level: 5,  required_std: '3pkt',  category_group: 1 },
  { item_code: 'FA-04', item_name: 'Sterile Gauze Pad 7.5cm',    unit: 'pkt',  current_stock: 0, min_alert_level: 10, required_std: '6pkt',  category_group: 1 },
  { item_code: 'FA-05', item_name: 'Sterile Gauze Pad 10cm',     unit: 'pkt',  current_stock: 0, min_alert_level: 10, required_std: '6pkt',  category_group: 1 },
  { item_code: 'FA-06', item_name: 'Elastic Bandage',            unit: 'pkt',  current_stock: 0, min_alert_level: 5,  required_std: '3pkt',  category_group: 1 },
  { item_code: 'FA-07', item_name: 'W.O.W Bandage 2.5cm',        unit: 'pcs',  current_stock: 0, min_alert_level: 15, required_std: '8pcs',  category_group: 1 },
  { item_code: 'FA-08', item_name: 'W.O.W Bandage 5.0cm',        unit: 'pcs',  current_stock: 0, min_alert_level: 15, required_std: '8pcs',  category_group: 1 },
  { item_code: 'FA-09', item_name: 'W.O.W Bandage 7.5cm',        unit: 'pcs',  current_stock: 0, min_alert_level: 15, required_std: '8pcs',  category_group: 1 },
  { item_code: 'FA-10', item_name: 'Instant Ice Pack',           unit: 'pkt',  current_stock: 0, min_alert_level: 10, required_std: '6pkt',  category_group: 2 },
  { item_code: 'FA-11', item_name: 'Sterile Non-Adherent Pad',   unit: 'pkt',  current_stock: 0, min_alert_level: 10, required_std: '6pkt',  category_group: 2 },
  { item_code: 'FA-12', item_name: 'Pair of Glove',              unit: 'pkt',  current_stock: 0, min_alert_level: 10, required_std: '6pkt',  category_group: 2 },
  { item_code: 'FA-13', item_name: 'Scissors',                   unit: 'pcs',  current_stock: 0, min_alert_level: 2,  required_std: '1pcs',  category_group: 3 },
  { item_code: 'FA-14', item_name: 'Adhesive Tape',              unit: 'pcs',  current_stock: 0, min_alert_level: 5,  required_std: '1pcs',  category_group: 2 },
  { item_code: 'FA-15', item_name: 'Bactigras',                  unit: 'pcs',  current_stock: 0, min_alert_level: 5,  required_std: '2pcs',  category_group: 2 },
  { item_code: 'FA-16', item_name: 'Yellow Antiseptic Liquid',   unit: 'pcs',  current_stock: 0, min_alert_level: 2,  required_std: '1pcs',  category_group: 3 },
  { item_code: 'FA-17', item_name: 'Cotton Bud 100pcs',          unit: 'pkt',  current_stock: 0, min_alert_level: 5,  required_std: '1pkt',  category_group: 2 },
  { item_code: 'FA-18', item_name: 'CPR Face Shield',            unit: 'pcs',  current_stock: 0, min_alert_level: 5,  required_std: '3pcs',  category_group: 1 },
  { item_code: 'FA-19', item_name: 'Adhesive Plaster',           unit: 'pcs',  current_stock: 0, min_alert_level: 100, required_std: '60pcs', category_group: 1 },
  { item_code: 'FA-20', item_name: 'Safety Pin',                 unit: 'pcs',  current_stock: 0, min_alert_level: 50, required_std: '36pcs', category_group: 1 },
  { item_code: 'FA-21', item_name: 'Thermometer',                unit: 'pcs',  current_stock: 0, min_alert_level: 2,  required_std: '1pcs',  category_group: 3 },
  { item_code: 'FA-22', item_name: 'Waste Bag',                  unit: 'pcs',  current_stock: 0, min_alert_level: 10, required_std: '3pcs',  category_group: 3 },
  { item_code: 'FA-23', item_name: 'First Aid Manual',           unit: 'pcs',  current_stock: 0, min_alert_level: 2,  required_std: '1pcs',  category_group: 3 },
];
