import {h} from 'vue'
import {ColumnDef} from "@tanstack/vue-table";
import {Badge} from '@/components/ui/badge'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime';
import DropdownAction from './TableDropdown.vue'
import {Button} from "@/components/ui/button";
import {ArrowUpDown} from "lucide-vue-next";


interface Alert {
    uuid: string
    device: string
    type: string
    since: string
    links: Array<{
        relation: string; target: string;
    }>;
}

export const columns: ColumnDef<Alert>[] = [{
    accessorKey: 'type',
    header: ({column}) => {
        return h(Button,
            {
                variant: 'ghost',
                size: 'noPadding',
                onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
            },
            () => [h('div',
                {class: 'flex gap-1 items-center justify center'},
                ['Alert', h(ArrowUpDown, {class: 'ml-2 h-4 w-4'})])])
    },
    cell: ({row}) => {

        return h(Badge, {variant: 'outline'}, () => row.getValue('type'))
    },
}, {
    accessorKey: 'device',
    header: ({column}) => {
        return h(Button,
            {
                variant: 'ghost',
                size: 'noPadding',
                onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
            },
            () => [h('div',
                {class: 'flex gap-1 items-center justify center'},
                ['Device', h(ArrowUpDown, {class: 'ml-2 h-4 w-4'})])])
    },
    cell: ({row}) => {

        return h('div', {class: 'text-right font-medium'}, row.getValue('device'))
    },
}, {
    accessorKey: 'since',
    header: ({column}) => {
        return h(Button,
            {
                variant: 'ghost',
                size: 'noPadding',
                onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
            },
            () => [h('div',
                {class: 'flex gap-1 items-center justify center'},
                ['Triggered', h(ArrowUpDown, {class: 'ml-2 h-4 w-4'})])])
    },
    cell: ({row}) => {

        dayjs.extend(relativeTime);
        return h('div', {class: 'text-right font-medium'}, dayjs(row.getValue('since')).fromNow())
    },
}, {
    id: 'actions',
    enableHiding: false,
    cell: ({row}) => {
        return h('div', {class: 'relative'}, h(DropdownAction, {
            uuid: row.original.uuid,
        }))
    },
},]
