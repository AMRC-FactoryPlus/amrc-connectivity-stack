/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {UDPConnection, UDPDevice} from '../../../lib/devices/UDP';
jest.mock('dgram'); 
import { Socket, createSocket, RemoteInfo } from 'dgram';
import { EventEmitter } from 'stream';

describe('UDPConnection', () => {
    const type = 'UDP';
    const connDetails = {
        port : 10
    };

    describe('open()', () => {
        
        it('should emit open', async ()=> {
            const mockedUdp = createSocket as jest.Mock;
            mockedUdp.mockImplementation(()=> {
                return new Socket; 
            })

            const UDPConn = new UDPConnection(type, connDetails);
            const callback = jest.fn();
            UDPConn.on("open", callback);
            UDPConn.open(); 
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(callback).toBeCalledTimes( 1 ); 
        })
    })

    describe('close()', () => {
        
        it('should call server.close()', () => {
            const mockedUdp = createSocket as jest.Mock;
            const mockSocket = new Socket;
            mockedUdp.mockImplementation(()=> {
                return mockSocket; 
            })

            const UDPConn = new UDPConnection(type, connDetails);
            UDPConn.close();
            expect(mockSocket.close).toBeCalledTimes( 1 ); 
        })
    })
    
    
})
