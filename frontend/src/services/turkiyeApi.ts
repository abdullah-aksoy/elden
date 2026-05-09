import axios from 'axios';

const client = axios.create({
  baseURL: 'https://api.turkiyeapi.dev/v1',
  timeout: 20000,
});

export type ProvinceRow = { id: number; name: string };
export type DistrictRow = { id: number; name: string };

let provincesCache: ProvinceRow[] | null = null;

export async function fetchProvinces(): Promise<ProvinceRow[]> {
  if (provincesCache?.length) return provincesCache;
  const { data } = await client.get<{ status: string; data: ProvinceRow[] }>('/provinces', {
    params: { fields: 'name,id' },
  });
  if (data.status !== 'OK' || !Array.isArray(data.data)) {
    throw new Error('İl listesi alınamadı');
  }
  provincesCache = data.data;
  return provincesCache;
}

const districtsCache = new Map<number, DistrictRow[]>();

export async function fetchDistrictsForProvince(provinceId: number): Promise<DistrictRow[]> {
  const hit = districtsCache.get(provinceId);
  if (hit) return hit;
  const { data } = await client.get<{ status: string; data: { districts: DistrictRow[] } }>(
    `/provinces/${provinceId}`,
    { params: { fields: 'districts' } }
  );
  if (data.status !== 'OK' || !data.data?.districts) {
    throw new Error('İlçe listesi alınamadı');
  }
  const list = data.data.districts.map((d) => ({ id: d.id, name: d.name }));
  districtsCache.set(provinceId, list);
  return list;
}
