import { useContext } from 'preact/hooks';
import { EditorCard, EditorFields, useEditorCards, type EditorCardState } from './EditorCard';
import { CardScope } from './scope';
import { assetSummary } from './summaries';
import { HELP } from '../../config/help';
import { cloneAsset, emptyAsset, type AssetModel } from '../../config/types';
import { MonthField, NumberField, TextField } from '../fields';
import { At } from '../problems';
import { GrowthField } from '../GrowthField';
import { IconHome } from '../icons';

interface AssetFieldsProps {
  asset: AssetModel;
  /** Off where the name is not this form's to edit: an option's change to a baseline asset. */
  showName?: boolean;
  onChange: (asset: AssetModel) => void;
}

/** An asset's value, how it changes, and when it is bought and sold (spec/03, Asset). */
export function AssetFields({ asset, showName = true, onChange }: AssetFieldsProps) {
  const patch = (changes: Partial<AssetModel>) => onChange({ ...asset, ...changes });
  return (
    <>
      <EditorFields title="Value">
        <div class="field-grid">
          {showName ? (
            <TextField field="name" label="Name" help={HELP.assetName} value={asset.name} required onInput={(name) => patch({ name })} />
          ) : null}
          <NumberField field="value"
            label="Value"
            help={HELP.assetValue}
            value={asset.value}
            step={1000}
            onChange={(value) => patch({ value })}
          />
          <GrowthField
            label="Appreciation"
            help={HELP.appreciation}
            rateHelp={HELP.appreciationRate}
            rateLabel="Yearly appreciation"
            rateMissing="Enter the yearly appreciation."
            field="appreciation"
            value={asset.appreciation}
            onChange={(appreciation) => patch({ appreciation })}
          />
        </div>
      </EditorFields>
      <EditorFields title="Purchase and sale">
        <div class="field-grid">
          <MonthField field="startDate"
            label="Purchase month"
            help={HELP.assetStartDate}
            value={asset.startDate}
            placeholder="Owned at the start"
            onChange={(startDate) => patch({ startDate })}
          />
          <MonthField field="sellDate"
            label="Sale month"
            help={HELP.assetSellDate}
            value={asset.sellDate}
            placeholder="Kept"
            onChange={(sellDate) => patch({ sellDate })}
          />
          <NumberField field="sellCosts"
            label="Selling costs"
            help={HELP.assetSellCosts}
            value={asset.sellCosts}
            step={0.5}
            placeholder="0"
            suffix="%"
            onChange={(sellCosts) => patch({ sellCosts })}
          />
        </div>
      </EditorFields>
    </>
  );
}

interface AssetCardProps extends EditorCardState {
  asset: AssetModel;
  index: number;
  onChange: (asset: AssetModel) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function AssetCard({ asset, index, onChange, onRemove, onDuplicate, open, autoFocus, onOpenChange }: AssetCardProps) {
  const title = asset.name.trim() || `Asset ${index + 1}`;
  const scope = useContext(CardScope);
  return (
    <EditorCard
      id={`${scope}asset-${asset.id}`}
      title={title}
      summary={assetSummary(asset)}
      open={open}
      autoFocus={autoFocus}
      onOpenChange={onOpenChange}
      actions={
        <>
          <button type="button" class="btn btn--quiet" aria-label={`Duplicate ${title}`} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" class="btn btn--quiet btn--danger" aria-label={`Remove ${title}`} onClick={onRemove}>
            Remove
          </button>
        </>
      }
    >
      <AssetFields asset={asset} onChange={onChange} />
    </EditorCard>
  );
}

interface AssetListProps {
  assets: AssetModel[];
  onChange: (assets: AssetModel[]) => void;
}

export function AssetList({ assets, onChange }: AssetListProps) {
  const cards = useEditorCards(assets);
  return (
    <div class="list-block">
      <div class="list-block__head">
        <h4>
          <span class="list-block__icon" aria-hidden="true">
            <IconHome />
          </span>
          Assets
        </h4>
        {/* Prepend so the new card appears next to this button without scrolling. */}
        <div class="list-block__actions">
          {cards.toggleAll}
          <button type="button" class="btn" onClick={() => {
            const added = emptyAsset();
            cards.openNew(added.id);
            onChange([added, ...assets]);
          }}>
            Add asset
          </button>
        </div>
      </div>
      <p class="list-block__hint">A home, a car or anything else you own. Its value counts toward net worth; it moves no cash until it is sold.</p>
      {assets.length === 0 ? (
        <p class="empty">None yet.</p>
      ) : (
        <ul class="row-list">
          {assets.map((asset, index) => (
            <At key={asset.id} sub={`assets.${index}`}>
            <AssetCard
              {...cards.cardProps(asset.id)}
              asset={asset}
              index={index}
              onChange={(next) => onChange(assets.map((existing, i) => (i === index ? next : existing)))}
              onRemove={() => onChange(assets.filter((_, i) => i !== index))}
              onDuplicate={() => {
                const duplicate = cloneAsset(asset);
                cards.openNew(duplicate.id);
                onChange([...assets.slice(0, index + 1), duplicate, ...assets.slice(index + 1)]);
              }}
            />
            </At>
          ))}
        </ul>
      )}
    </div>
  );
}
