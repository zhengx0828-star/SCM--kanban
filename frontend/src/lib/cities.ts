/** 中国省级行政区经纬度表（WGS84，供供应商录入时自动带出坐标）。
 *
 * 覆盖全国 34 个省级行政区：23 省（含台湾省）+ 5 自治区 + 4 直辖市 + 2 特别行政区。
 * 坐标取各省省会/行政中心；特别行政区与台湾省按规范标注「中国香港 / 中国澳门 / 中国台湾」。
 */

export interface CityOption {
  name: string;
  longitude: number;
  latitude: number;
}

export const CITIES: CityOption[] = [
  /* 直辖市 */
  { name: "北京", longitude: 116.4, latitude: 39.9 },
  { name: "天津", longitude: 117.2, latitude: 39.13 },
  { name: "上海", longitude: 121.47, latitude: 31.23 },
  { name: "重庆", longitude: 106.55, latitude: 29.56 },
  /* 省（按行政区划常规顺序） */
  { name: "河北", longitude: 114.51, latitude: 38.04 }, // 石家庄
  { name: "山西", longitude: 112.55, latitude: 37.87 }, // 太原
  { name: "辽宁", longitude: 123.43, latitude: 41.8 }, // 沈阳
  { name: "吉林", longitude: 125.32, latitude: 43.9 }, // 长春
  { name: "黑龙江", longitude: 126.63, latitude: 45.75 }, // 哈尔滨
  { name: "江苏", longitude: 118.78, latitude: 32.04 }, // 南京
  { name: "浙江", longitude: 120.15, latitude: 30.28 }, // 杭州
  { name: "安徽", longitude: 117.23, latitude: 31.82 }, // 合肥
  { name: "福建", longitude: 119.3, latitude: 26.08 }, // 福州
  { name: "江西", longitude: 115.86, latitude: 28.68 }, // 南昌
  { name: "山东", longitude: 117.12, latitude: 36.65 }, // 济南
  { name: "河南", longitude: 113.62, latitude: 34.75 }, // 郑州
  { name: "湖北", longitude: 114.3, latitude: 30.59 }, // 武汉
  { name: "湖南", longitude: 112.94, latitude: 28.23 }, // 长沙
  { name: "广东", longitude: 113.26, latitude: 23.13 }, // 广州
  { name: "海南", longitude: 110.32, latitude: 20.03 }, // 海口
  { name: "四川", longitude: 104.07, latitude: 30.57 }, // 成都
  { name: "贵州", longitude: 106.63, latitude: 26.65 }, // 贵阳
  { name: "云南", longitude: 102.71, latitude: 25.05 }, // 昆明
  { name: "陕西", longitude: 108.94, latitude: 34.34 }, // 西安
  { name: "甘肃", longitude: 103.83, latitude: 36.06 }, // 兰州
  { name: "青海", longitude: 101.78, latitude: 36.62 }, // 西宁
  { name: "中国台湾", longitude: 121.56, latitude: 25.03 }, // 台北
  /* 自治区 */
  { name: "内蒙古", longitude: 111.75, latitude: 40.84 }, // 呼和浩特
  { name: "广西", longitude: 108.37, latitude: 22.82 }, // 南宁
  { name: "西藏", longitude: 91.11, latitude: 29.97 }, // 拉萨
  { name: "宁夏", longitude: 106.23, latitude: 38.49 }, // 银川
  { name: "新疆", longitude: 87.62, latitude: 43.82 }, // 乌鲁木齐
  /* 特别行政区 */
  { name: "中国香港", longitude: 114.17, latitude: 22.32 },
  { name: "中国澳门", longitude: 113.55, latitude: 22.2 },
];
