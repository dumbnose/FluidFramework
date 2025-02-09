/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { assert, assertNotUndefined, copyPropertyIfDefined, fail } from '../Common';
import { NodeId, DetachedSequenceId, TraitLabel } from '../Identifiers';
import { GenericTransaction, EditNode, EditResult } from '../generic';
import { Snapshot, SnapshotNode } from '../Snapshot';
import { EditValidationResult } from '../Checkout';
import { Build, Change, ChangeType, Constraint, ConstraintEffect, Detach, Insert, SetValue } from './PersistedTypes';
import {
	detachRange,
	insertIntoTrait,
	rangeFromStableRange,
	validateStablePlace,
	validateStableRange,
	isDetachedSequenceId,
} from './EditUtilities';
/**
 * A mutable transaction for applying sequences of changes to a Snapshot.
 * Allows viewing the intermediate states.
 *
 * Contains necessary state to apply changes within an edit to a Snapshot.
 *
 * May have any number of changes applied to make up the edit.
 * Use `close` to complete the transaction, returning the array of changes and an EditingResult showing the
 * results of applying the changes as an Edit to the initial Snapshot (passed to the constructor).
 *
 * No data outside the Transaction is modified by Transaction:
 * the results from `close` must be used to actually submit an `Edit`.
 */
export class Transaction extends GenericTransaction<Change> {
	protected readonly detached: Map<DetachedSequenceId, readonly NodeId[]> = new Map();

	public static factory(snapshot: Snapshot): Transaction {
		return new Transaction(snapshot);
	}

	protected validateOnClose(): EditResult {
		// Making the policy choice that storing a detached sequences in an edit but not using it is an error.
		return this.detached.size !== 0 ? EditResult.Malformed : EditResult.Applied;
	}

	protected dispatchChange(change: Change): EditResult {
		switch (change.type) {
			case ChangeType.Build:
				return this.applyBuild(change);
			case ChangeType.Insert:
				return this.applyInsert(change);
			case ChangeType.Detach:
				return this.applyDetach(change);
			case ChangeType.Constraint:
				return this.applyConstraint(change);
			case ChangeType.SetValue:
				return this.applySetValue(change);
			default:
				return fail('Attempted to apply unsupported change');
		}
	}

	private applyBuild(change: Build): EditResult {
		if (this.detached.has(change.destination)) {
			return EditResult.Malformed;
		}

		let idAlreadyPresent = false;
		let duplicateIdInBuild = false;
		const map = new Map<NodeId, SnapshotNode>();
		let detachedSequenceNotFound = false;
		const newIds = this.createSnapshotNodesForTree(
			change.source,
			(id, snapshotNode) => {
				if (map.has(id)) {
					duplicateIdInBuild = true;
					return true;
				}
				if (this.view.hasNode(id)) {
					idAlreadyPresent = true;
					return true;
				}
				map.set(id, snapshotNode);
				return false;
			},
			() => {
				detachedSequenceNotFound = true;
			}
		);

		if (detachedSequenceNotFound || duplicateIdInBuild) {
			return EditResult.Malformed;
		}
		if (idAlreadyPresent) {
			return EditResult.Invalid;
		}

		const view = this.view.insertSnapshotNodes(map);
		this._view = view;
		this.detached.set(change.destination, assertNotUndefined(newIds));
		return EditResult.Applied;
	}

	private applyInsert(change: Insert): EditResult {
		const source = this.detached.get(change.source);
		if (source === undefined) {
			return EditResult.Malformed;
		}

		const destinationChangeResult = validateStablePlace(this.view, change.destination);
		if (destinationChangeResult !== EditValidationResult.Valid) {
			return destinationChangeResult === EditValidationResult.Invalid ? EditResult.Invalid : EditResult.Malformed;
		}

		this.detached.delete(change.source);
		this._view = insertIntoTrait(this.view, source, change.destination);
		return EditResult.Applied;
	}

	private applyDetach(change: Detach): EditResult {
		const sourceChangeResult = validateStableRange(this.view, change.source);
		if (sourceChangeResult !== EditValidationResult.Valid) {
			return sourceChangeResult === EditValidationResult.Invalid ? EditResult.Invalid : EditResult.Malformed;
		}

		const result = detachRange(this.view, change.source);
		let modifiedView = result.snapshot;
		const { detached } = result;

		// Store or dispose detached
		if (change.destination !== undefined) {
			if (this.detached.has(change.destination)) {
				return EditResult.Malformed;
			}
			this.detached.set(change.destination, detached);
		} else {
			modifiedView = modifiedView.deleteNodes(detached);
		}

		this._view = modifiedView;
		return EditResult.Applied;
	}

	private applyConstraint(change: Constraint): EditResult {
		// TODO: Implement identityHash and contentHash
		assert(change.identityHash === undefined, 'identityHash constraint is not implemented');
		assert(change.contentHash === undefined, 'contentHash constraint is not implemented');

		const sourceChangeResult = validateStableRange(this.view, change.toConstrain);
		const onViolation = change.effect === ConstraintEffect.ValidRetry ? EditResult.Applied : EditResult.Invalid;
		if (sourceChangeResult !== EditValidationResult.Valid) {
			return sourceChangeResult === EditValidationResult.Invalid ? onViolation : EditResult.Malformed;
		}

		const { start, end } = rangeFromStableRange(this.view, change.toConstrain);
		const startIndex = this.view.findIndexWithinTrait(start);
		const endIndex = this.view.findIndexWithinTrait(end);

		if (change.length !== undefined && change.length !== endIndex - startIndex) {
			return onViolation;
		}

		if (change.parentNode !== undefined && change.parentNode !== end.trait.parent) {
			return onViolation;
		}

		if (change.label !== undefined && change.label !== end.trait.label) {
			return onViolation;
		}

		return EditResult.Applied;
	}

	private applySetValue(change: SetValue): EditResult {
		if (!this.view.hasNode(change.nodeToModify)) {
			return EditResult.Invalid;
		}

		const node = this.view.getSnapshotNode(change.nodeToModify);
		const { payload } = change;
		const newNode = { ...node };
		// Rationale: 'undefined' is reserved for future use (see 'SetValue' interface defn.)
		// eslint-disable-next-line no-null/no-null
		if (payload === null) {
			delete newNode.payload;
		} else {
			// TODO: detect payloads that are not Fluid Serializable here.
			// The consistency of editing does not actually depend on payloads being well formed,
			// but its better to detect bugs producing bad payloads here than let them pass.
			newNode.payload = payload;
		}
		this._view = this.view.replaceNodeData(change.nodeToModify, newNode);
		return EditResult.Applied;
	}

	/**
	 * Generates snapshot nodes from the supplied edit nodes.
	 * Invokes onCreateNode for each new snapshot node, and halts creation early if it returns true.
	 * Invokes onInvalidDetachedId and halts early for any invalid detached IDs referenced in the edit node sequence.
	 * @returns all the top-level node IDs in `sequence` (both from nodes and from detached sequences).
	 */
	protected createSnapshotNodesForTree(
		sequence: Iterable<EditNode>,
		onCreateNode: (id: NodeId, node: SnapshotNode) => boolean,
		onInvalidDetachedId: () => void
	): NodeId[] | undefined {
		const topLevelIds: NodeId[] = [];
		const unprocessed: EditNode[] = [];
		for (const editNode of sequence) {
			if (isDetachedSequenceId(editNode)) {
				const detachedIds = this.getDetachedNodeIds(editNode, onInvalidDetachedId);
				if (detachedIds === undefined) {
					return undefined;
				}
				topLevelIds.push(...detachedIds);
			} else {
				unprocessed.push(editNode);
				topLevelIds.push(editNode.identifier);
			}
		}
		while (unprocessed.length > 0) {
			const node = unprocessed.pop();
			assert(node !== undefined && !isDetachedSequenceId(node));
			const traits = new Map<TraitLabel, readonly NodeId[]>();
			// eslint-disable-next-line no-restricted-syntax
			for (const key in node.traits) {
				if (Object.prototype.hasOwnProperty.call(node.traits, key)) {
					const children = node.traits[key];
					const childIds: NodeId[] = [];
					for (const child of children) {
						if (isDetachedSequenceId(child)) {
							const detachedIds = this.getDetachedNodeIds(child, onInvalidDetachedId);
							if (detachedIds === undefined) {
								return undefined;
							}
							childIds.push(...detachedIds);
						} else {
							childIds.push(child.identifier);
							unprocessed.push(child);
						}
					}
					traits.set(key as TraitLabel, childIds);
				}
			}
			const newNode: SnapshotNode = {
				identifier: node.identifier,
				definition: node.definition,
				traits,
			};
			copyPropertyIfDefined(node, newNode, 'payload');
			if (onCreateNode(newNode.identifier, newNode)) {
				return undefined;
			}
		}
		return topLevelIds;
	}

	private getDetachedNodeIds(
		detachedId: DetachedSequenceId,
		onInvalidDetachedId: () => void
	): readonly NodeId[] | undefined {
		// Retrieve the detached sequence from the void.
		const detachedNodeIds = this.detached.get(detachedId);
		if (detachedNodeIds === undefined) {
			onInvalidDetachedId();
			return undefined;
		}
		// Since we have retrieved the sequence, remove it from the void to prevent a second tree from multi-parenting it later
		this.detached.delete(detachedId);
		return detachedNodeIds;
	}
}
