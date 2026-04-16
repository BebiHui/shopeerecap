-- ============================================================
-- ShopeeRekap v2 — Seed Data (Toko Sparepart Motor)
-- ============================================================
-- CARA PAKAI:
-- 1. Daftar akun di aplikasi (localhost:3000/login)
-- 2. Buka Supabase Dashboard → Authentication → Users
-- 3. Copy UUID user Anda
-- 4. Ganti 'GANTI_DENGAN_USER_ID_ANDA' di bawah
-- 5. Jalankan di SQL Editor
-- ============================================================

do $$
declare
  v_uid uuid := 'GANTI_DENGAN_USER_ID_ANDA';  -- ← GANTI INI

  -- Produk sparepart motor
  type t_prod is record (name text, sku text, price numeric, modal numeric, cat text);
  prods t_prod[] := array[
    row('Kampas Rem Depan Honda Vario 125',  'KRD-VR125',  55000,  25000, 'Rem'),
    row('Oli Mesin Yamalube 10W-40 1L',      'OLI-YML10W', 78000,  38000, 'Oli'),
    row('Filter Udara Beat FI Original',     'FUA-BEAT',   65000,  32000, 'Filter'),
    row('Busi NGK CPR8EA-9 Honda',           'BSI-NGK-C',  42000,  18000, 'Busi'),
    row('Ban IRC Tubeless 80/90-14',         'BAN-IRC-89', 385000, 185000,'Ban'),
    row('Rantai RK 428H-116L Gold',          'RNT-RK428',  195000, 95000, 'Rantai'),
    row('Kampas Kopling Jupiter Z Set',      'KPL-JPT-Z',  58000,  28000, 'Kopling'),
    row('Oli Gardan Yamaha NMAX 100ml',      'OGD-NMX-1',  28000,  12000, 'Oli'),
    row('Bearing Roda Depan Vario 150',      'BRG-VR150',  48000,  22000, 'Bearing'),
    row('V-Belt Honda PCX 160 OEM',          'VBT-PCX160', 175000, 85000, 'Transmisi')
  ];

  buyers text[] := array[
    'Budi Santoso','Siti Rahma','Ahmad Fauzi','Dewi Lestari',
    'Rendi Pratama','Yuli Handayani','Dimas Eko','Farida Hanum',
    'Agus Setiawan','Novi Rahayu','Hendra Wijaya','Rina Kusuma'
  ];

  v_date   date;
  v_prod   t_prod;
  v_buyer  text;
  v_qty    int;
  v_jual   numeric;
  v_admin  numeric;
  v_lay    numeric;
  v_prog   numeric;
  v_aff    numeric;
  v_ongkir numeric;
  v_voucher numeric;
  v_iklan  numeric;
  v_order  text;
  i int;
  d int;
begin

  -- Update/insert profile
  insert into public.profiles (id, store_name, owner_name)
  values (v_uid, 'Toko Kencana Motor', 'Bapak Hendra')
  on conflict (id) do update set store_name = excluded.store_name, owner_name = excluded.owner_name;

  -- Insert products
  for i in 1..array_length(prods, 1) loop
    insert into public.products (user_id, name, sku, default_price, default_modal, category, is_active)
    values (v_uid, prods[i].name, prods[i].sku, prods[i].price, prods[i].modal, prods[i].cat, true)
    on conflict do nothing;
  end loop;

  -- Generate 14 days of transactions
  for d in 0..13 loop
    v_date := current_date - d;

    -- 8-14 orders per day
    for i in 1..(8 + floor(random()*7)::int) loop
      -- Pick random product & buyer
      v_prod  := prods[1 + floor(random() * array_length(prods,1))::int];
      v_buyer := buyers[1 + floor(random() * array_length(buyers,1))::int];

      v_qty   := 1 + floor(random()*2)::int;
      v_jual  := round(v_prod.price / 500) * 500;

      -- Shopee fee components (realistic rates)
      v_admin  := round(v_jual * v_qty * 0.022 / 500) * 500;
      v_lay    := round(v_jual * v_qty * 0.010 / 500) * 500;
      v_prog   := case when random() > 0.55 then round(v_jual * v_qty * 0.04 / 500) * 500 else 0 end;
      v_aff    := case when random() > 0.80 then round(v_jual * v_qty * 0.03 / 500) * 500 else 0 end;
      v_ongkir := case when random() > 0.55 then round((3000 + random()*7000) / 500) * 500 else 0 end;
      v_voucher := case when random() > 0.70 then round(random() * 10000 / 500) * 500 else 0 end;
      v_iklan  := case when random() > 0.45 then round(random() * 5000 / 500) * 500 else 0 end;

      -- Order ID format: 25YYMMDDXXXXXX
      v_order := '25' || to_char(v_date, 'YYMMDD') ||
                 lpad((i * 31 + d * 7)::text, 4, '0') ||
                 lpad(floor(random()*100)::text, 2, '0');

      insert into public.transactions (
        user_id, tanggal, order_id, nama_pembeli, nama_produk, sku,
        qty, harga_jual, harga_modal,
        diskon_produk, voucher_shopee,
        biaya_admin, biaya_layanan, biaya_program, biaya_affiliate,
        ongkir_seller, biaya_iklan
      ) values (
        v_uid, v_date, v_order, v_buyer, v_prod.name, v_prod.sku,
        v_qty, v_jual, v_prod.modal,
        0, v_voucher,
        v_admin, v_lay, v_prog, v_aff,
        v_ongkir, v_iklan
      )
      on conflict (user_id, order_id, nama_produk) do nothing;
    end loop;

    -- Daily ads cost
    insert into public.daily_ads (user_id, tanggal, total, keterangan)
    values (v_uid, v_date, round((30000 + random()*70000) / 1000) * 1000, 'Shopee Ads')
    on conflict (user_id, tanggal) do nothing;

  end loop;

  raise notice 'Seed selesai untuk user %', v_uid;
end $$;

-- ============================================================
-- Seed Master SKU (jalankan setelah seed transaksi)
-- ============================================================
insert into public.master_sku
  (user_id, sku, sku_induk, nama_produk, nama_variasi, harga_modal, kategori, supplier, is_active)
values
  (v_uid, 'KRD-VR125',  null,        'Kampas Rem Depan Honda Vario 125', 'Standar',  25000, 'Rem',       'Supplier ABC', true),
  (v_uid, 'OLI-YML10W', null,        'Oli Mesin Yamalube 10W-40 1L',      '1 Liter',  38000, 'Oli',       'Distributor XYZ', true),
  (v_uid, 'FUA-BEAT',   null,        'Filter Udara Beat FI Original',     'Original', 32000, 'Filter',    'Toko Sparepart', true),
  (v_uid, 'BSI-NGK-C',  null,        'Busi NGK CPR8EA-9 Honda',           'CPR8EA-9', 18000, 'Busi',      'Supplier ABC', true),
  (v_uid, 'BAN-IRC-89', 'BAN-IRC',   'Ban IRC Tubeless 80/90-14',         '80/90-14', 185000,'Ban',       'Distributor XYZ', true),
  (v_uid, 'RNT-RK428',  null,        'Rantai RK 428H-116L Gold',          '116L',     95000, 'Rantai',    'Toko Sparepart', true),
  (v_uid, 'KPL-JPT-Z',  null,        'Kampas Kopling Jupiter Z Set',      'Set',      28000, 'Kopling',   'Supplier ABC', true),
  (v_uid, 'OGD-NMX-1',  null,        'Oli Gardan Yamaha NMAX 100ml',      '100ml',    12000, 'Oli',       'Distributor XYZ', true),
  (v_uid, 'BRG-VR150',  null,        'Bearing Roda Depan Vario 150',      'Depan',    22000, 'Bearing',   'Supplier ABC', true),
  (v_uid, 'VBT-PCX160', null,        'V-Belt Honda PCX 160 OEM',          'OEM',      85000, 'Transmisi', 'Toko Sparepart', true)
on conflict (user_id, sku) do nothing;
