import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import DataTableRowActions from '@/components/ui/data-table/DataTableRowActions.vue'
import {Badge} from '@/components/ui/badge'
import TooltipCell from '@/components/ui/data-table/cells/TooltipCell.vue'
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

export const columns: ColumnDef<Alert>[] = [{
    accessorKey: 'type',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Alert'
    }),
    cell: ({row}) => h(Badge, {}, () => row.getValue('type')),
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
}, {
    accessorKey: 'device',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Device'
    }),

    cell: ({row}) => {
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('device'))
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
}, {
    accessorKey: 'since',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Triggered'
    }),

    cell: ({row}) => {
        return h(TooltipCell, {
            content: dayjs(row.getValue('since')).fromNow(),
            tooltip: dayjs(row.getValue('since')).format('YYYY-MM-DD HH:mm:ss')
        });
    },
}, {
    accessorKey: 'links',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Links'
    }),

    cell: ({row}) => {
        // return h('span', { class: 'max-w-[500px] truncate font-medium' }, row.original.links.map(link => `${link.relation}: ${link.target}`).join(', '))
        return h('div', {class: 'max-w-[500px]'}, row.original.links.map(link => {
            return h(Badge, {variant: 'outline'}, `${link.relation}: ${link.target}`);
        }));
    },
}, {
    id: 'actions',
    cell: ({row}) => h(DataTableRowActions, {row}),
},]
