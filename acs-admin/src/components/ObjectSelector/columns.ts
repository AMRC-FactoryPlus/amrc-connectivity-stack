/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import {Checkbox} from '@/components/ui/checkbox'
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

export interface Alert {
    uuid: string
    device: string
    type: string
    since: string
    links: Array<{
        relation: string; target: string;
    }>;
}

dayjs.extend(relativeTime);

export function buildColumns(valueKey, titleKey, titleHeader, detailKey, detailHeader): ColumnDef<Alert>[] {
    return [
        {
            id: 'select',
            header: ({table}) => h(Checkbox, {
                'checked': table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate'),
                'onUpdate:checked': value => table.toggleAllPageRowsSelected(!!value),
                'ariaLabel': 'Select all',
            }),
            cell: ({row}) => h(Checkbox, {
                'checked': row.getIsSelected(),
                'onUpdate:checked': value => row.toggleSelected(!!value),
                'ariaLabel': 'Select row',
            }),
            enableSorting: false,
            enableHiding: false,
        },
        {
            accessorKey: titleKey,
            header: ({column}) => h(DataTableColumnHeader, {
                column,
                title: titleHeader
            }),
            cell: ({row}) => h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue(titleKey)),
        },
        {
            accessorKey: detailKey,
            header: ({column}) => h(DataTableColumnHeader, {
                column,
                title: detailHeader
            }),
            cell: ({row}) => h('span', {class: 'max-w-[500px] truncate text-gray-600'}, row.getValue(detailKey)),
        }
    ]

}