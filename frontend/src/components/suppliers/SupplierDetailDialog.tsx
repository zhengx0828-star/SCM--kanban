import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Boxes,
  Building2,
  Loader2,
  Mail,
  MapPin,
  MapPinOff,
  Package,
  Pencil,
  Phone,
  Save,
  ShieldAlert,
  StickyNote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useUpdateSupplier } from "@/hooks/use-suppliers";
import { getApiErrorMessage } from "@/lib/utils";
import { RISK_META, supplierRiskOf, type Supplier } from "@/types/supplier";

interface SupplierDetailDialogProps {
  /** 当前查看的供应商，null 时关闭 */
  supplier: Supplier | null;
  onClose: () => void;
}

/** 地图点位点击后的供应商详情弹窗
 * - 默认只读，点击底部「编辑」进入编辑模式可改：联系人 / 联系电话 / 供应物料 / 备注
 * - 「关联物料」一栏同时显示 PN 与物料名称（PN · 名称）
 * - 字段缺失值统一用「未填写」占位
 *
 * ★ 撤点位 ≠ 删供应商：地图点位只是主数据上的城市 + 经纬度。用户要的是「这个点别显示了」，
 *   所以这里只提供「撤掉地图点位」（PATCH 经纬度为 null），**不提供删除供应商**，
 *   避免把 supplier 删掉后 supply_relations 外键 CASCADE 连带清空项目供应关系。
 *   删除供应商请到「供应商列表」，那里会明确标注关系一并移除。
 */
export function SupplierDetailDialog({ supplier, onClose }: SupplierDetailDialogProps) {
  const updateMutation = useUpdateSupplier();
  // 撤点位二次确认（不是删除，仅清空经纬度）
  const [mapRemoveOpen, setMapRemoveOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 本地副本：编辑保存后用服务端返回的最新 supplier 覆盖；切供应商时用 prop 重置
  const [current, setCurrent] = useState<Supplier | null>(supplier);
  useEffect(() => {
    setCurrent(supplier);
    setEditing(false);
    setError(null);
    setMapRemoveOpen(false);
  }, [supplier]);

  // 编辑态表单
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [supplyMaterial, setSupplyMaterial] = useState("");
  const [remark, setRemark] = useState("");

  useEffect(() => {
    if (!editing || !current) return;
    setContactPerson(current.contact_person ?? "");
    setPhone(current.phone ?? "");
    setSupplyMaterial(current.supply_material ?? "");
    setRemark(current.remark ?? "");
  }, [editing, current]);

  /** 撤掉地图点位：只清空经纬度，供应商主数据与供应关系原样保留 */
  const handleRemoveFromMap = () => {
    if (!current) return;
    setError(null);
    updateMutation.mutate(
      { id: current.id, data: { longitude: null, latitude: null } },
      {
        onSuccess: (updated) => {
          setCurrent(updated);
          setMapRemoveOpen(false);
          onClose(); // 关掉弹窗，让用户直接看到点位已从地图消失
          toast.success("已撤掉地图点位，供应商与供应关系均保留");
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      }
    );
  };

  const handleSave = () => {
    if (!current) return;
    setError(null);
    updateMutation.mutate(
      {
        id: current.id,
        data: {
          contact_person: contactPerson.trim() || null,
          phone: phone.trim() || null,
          supply_material: supplyMaterial.trim() || null,
          remark: remark.trim() || null,
        },
      },
      {
        onSuccess: (updated) => {
          setCurrent(updated);
          setEditing(false);
          toast.success("已保存");
        },
        onError: (err) => setError(getApiErrorMessage(err)),
      }
    );
  };

  /** 是否有坐标（决定能否撤点位；无坐标本就不上图） */
  const hasCoords = current?.longitude != null && current?.latitude != null;

  return (
    <>
      <Dialog open={supplier !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          {current && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 pr-8">
                  <DialogTitle className="flex-1 break-all">{current.name}</DialogTitle>
                  {(() => {
                    const key = supplierRiskOf(current);
                    const meta = RISK_META[key];
                    return (
                      <Badge
                        className="shrink-0"
                        style={{
                          backgroundColor: `${meta.color}1a`,
                          color: meta.color,
                          borderColor: `${meta.color}40`,
                        }}
                      >
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: meta.color }}
                        />
                        {meta.label}
                      </Badge>
                    );
                  })()}
                </div>
                <DialogDescription>{RISK_META[supplierRiskOf(current)].desc}</DialogDescription>
              </DialogHeader>

              {/* 单列纵向布局：每个信息块占一行、标题统一、缺失值用「未填写」灰字占位 */}
              <div className="space-y-3.5 text-sm">
                {/* 红黄绿判定依据：点开就知道为什么是这个颜色 */}
                <Field
                  icon={<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  label="风险判定依据"
                >
                  {(current.risk?.reasons?.length ?? 0) > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {current.risk!.reasons.map((r) => (
                        <li key={r.code} className="flex items-start gap-1.5 text-xs">
                          <span
                            className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: RISK_META[supplierRiskOf(current)].color }}
                          />
                          <span className="min-w-0">
                            <span className="font-medium">{r.label}</span>
                            <span className="mx-1 text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{r.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      红黄情形一条都不命中。没录份额 / 库存档案的也算绿，绿色只代表「没有已知问题」。
                    </p>
                  )}
                </Field>

                {/* 省份 + 经纬度 */}
                <Field icon={<MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}>
                  <p className="font-medium">{current.city ?? "省份未设置"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {current.longitude != null && current.latitude != null
                      ? `经度 ${current.longitude} · 纬度 ${current.latitude}`
                      : "尚未补全坐标，未显示在地图上（可在地图录入中补全）"}
                  </p>
                </Field>

                {/* 供应商代码 + 供应物料（冗余文本） */}
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={<BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}>
                    <p className="font-medium">供应商代码</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{current.code}</p>
                  </Field>
                  <Field
                    icon={<Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    label="供应物料"
                    value={editing ? supplyMaterial : current.supply_material}
                    placeholder="未填写"
                    editing={editing}
                    onChange={setSupplyMaterial}
                    textarea
                  />
                </div>

                {/* 关联物料（PN · 名称），来自 L2 供应关系；可能为空 */}
                <Field
                  icon={<Boxes className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  label="关联物料（PN · 名称）"
                >
                  {(current.materials?.length ?? 0) > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {current.materials!.map((m) => (
                        <Badge key={m.id} variant="outline" className="px-2 py-0.5 text-xs font-normal">
                          <span className="font-mono text-[11px]">{m.pn}</span>
                          <span className="mx-1 text-muted-foreground">·</span>
                          <span>{m.name}</span>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">未关联物料（去「供应商列表」供应关系 Tab 挂载）</p>
                  )}
                </Field>

                {/* 联系人 + 联系电话 */}
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    icon={<Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    label="联系人"
                    value={editing ? contactPerson : current.contact_person}
                    placeholder="未填写"
                    editing={editing}
                    onChange={setContactPerson}
                  />
                  <Field
                    icon={<Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    label="联系电话"
                    value={editing ? phone : current.phone}
                    placeholder="未填写"
                    editing={editing}
                    onChange={setPhone}
                  />
                </div>

                {/* 备注（编辑模式变 Textarea，只读模式按行展示） */}
                {editing ? (
                  <div>
                    <Label htmlFor="supplier-detail-remark" className="text-sm font-medium">
                      备注
                    </Label>
                    <Textarea
                      id="supplier-detail-remark"
                      className="mt-1.5"
                      rows={2}
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      placeholder="选填"
                    />
                  </div>
                ) : (
                  current.remark && (
                    <Field icon={<StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />} label="备注">
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{current.remark}</p>
                    </Field>
                  )
                )}

                {/* 录入时间 */}
                <Field icon={<Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}>
                  <p className="text-xs text-muted-foreground">
                    录入时间：{new Date(current.created_at).toLocaleString("zh-CN")}
                  </p>
                </Field>

                {error && <p className="text-xs text-red-500">{error}</p>}

                {/* 撤点位的口径说明：避免和「删除供应商」混为一谈 */}
                <p className="text-xs text-muted-foreground">
                  撤点位只清空经纬度，供应商主数据与供应关系不动。删除供应商请到「供应商列表」。
                </p>
              </div>

              {/* 底部操作栏：编辑模式显示保存/取消；只读模式显示撤点位/编辑 */}
              <div className="mt-4 flex items-center justify-between border-t pt-4">
                {editing ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={updateMutation.isPending}>
                      <X className="mr-1.5 h-4 w-4" />
                      取消
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-1.5 h-4 w-4" />
                      )}
                      保存
                    </Button>
                  </>
                ) : (
                  <>
                    {hasCoords ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMapRemoveOpen(true)}
                        disabled={updateMutation.isPending}
                      >
                        <MapPinOff className="mr-1.5 h-4 w-4" />
                        撤掉地图点位
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">未设置坐标，不上图</span>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      <Pencil className="mr-1.5 h-4 w-4" />
                      编辑
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 撤点位二次确认（不是删除：只清空经纬度） */}
      <AlertDialog open={mapRemoveOpen} onOpenChange={setMapRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MapPinOff className="h-4 w-4 text-muted-foreground" />
              撤掉这个地图点位？
            </AlertDialogTitle>
            <AlertDialogDescription>
              仅清空「{current?.name}」的经纬度，地图上不再显示该点位；供应商主数据与
              {current?.materials?.length ?? 0} 条供应关系全部保留。需要重新上图时，在「录入供应商」里补坐标即可。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={updateMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleRemoveFromMap();
              }}
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认撤点
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** 信息块：图标 + 标题 + 内容 / 编辑态变 Input（或 Textarea） */
function Field({
  icon,
  label,
  value,
  placeholder,
  editing,
  onChange,
  textarea,
  children,
}: {
  icon: React.ReactNode;
  label?: string;
  value?: string | null;
  placeholder?: string;
  editing?: boolean;
  onChange?: (v: string) => void;
  textarea?: boolean;
  children?: React.ReactNode;
}) {
  if (editing) {
    return (
      <div>
        {label && <Label className="text-sm font-medium">{label}</Label>}
        <div className="mt-1.5">
          {textarea ? (
            <Textarea
              rows={1}
              value={value ?? ""}
              onChange={(e) => onChange?.(e.target.value)}
              placeholder={placeholder}
            />
          ) : (
            <Input value={value ?? ""} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} />
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        {label && <p className="font-medium">{label}</p>}
        {children}
      </div>
    </div>
  );
}
