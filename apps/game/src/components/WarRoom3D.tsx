import { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, Sparkles, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import { type WorldSnapshot } from "@helm/sim-core";

const severityColors: Record<string, string> = {
  green: "#10b981",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  black: "#a855f7", // Using purple/magenta for black to make it glow vividly
};

function DataCube({ card, index, total }: { card: any; index: number; total: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useEffect(() => {
    return () => {
      if (meshRef.current) {
        meshRef.current.geometry?.dispose();
        if (Array.isArray(meshRef.current.material)) {
          meshRef.current.material.forEach((m: any) => m.dispose());
        } else {
          (meshRef.current.material as any)?.dispose();
        }
      }
    };
  }, []);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += 0.01;
      meshRef.current.rotation.y += 0.02;
      // Float along a horizontal stream
      const time = state.clock.getElapsedTime();
      const offset = (index / total) * Math.PI * 2;
      meshRef.current.position.y = Math.sin(time * 2 + offset) * 0.5;
    }
  });

  const color = severityColors[card.severity] || severityColors.green;
  const isHighRisk = card.severity === "red" || card.severity === "black";

  return (
    <Float speed={2} rotationIntensity={1} floatIntensity={2}>
      <mesh ref={meshRef} position={[(index - total / 2) * 1.5, 0, 0]} scale={isHighRisk ? 1.2 : 1}>
        <boxGeometry args={[1, 1, 1]} />
        {isHighRisk ? (
          <MeshDistortMaterial color={color} emissive={color} emissiveIntensity={2} distort={0.4} speed={5} roughness={0.2} metalness={0.8} />
        ) : (
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} roughness={0.1} metalness={0.8} opacity={0.8} transparent />
        )}
      </mesh>
    </Float>
  );
}

function ServerRack({ packId, index, total, isUnlocked }: { packId: string; index: number; total: number; isUnlocked: boolean }) {
  const angle = (index / total) * Math.PI * 2;
  const radius = 8;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  
  return (
    <mesh position={[x, 0, z]} rotation={[0, -angle + Math.PI/2, 0]}>
      <boxGeometry args={[2, 6, 1]} />
      <meshStandardMaterial 
        color={isUnlocked ? "#0ea5e9" : "#1e293b"} 
        emissive={isUnlocked ? "#0ea5e9" : "#000000"} 
        emissiveIntensity={isUnlocked ? 1.5 : 0} 
        wireframe={!isUnlocked}
      />
    </mesh>
  );
}

function Scene({ world }: { world: WorldSnapshot }) {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (groupRef.current) {
      // Slowly rotate the entire scene
      groupRef.current.rotation.y = state.clock.getElapsedTime() * 0.05;
    }
  });

  // Extract packs
  const allPackIds = Object.keys(world.packs);
  
  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.2} />
      <pointLight position={[0, 10, 0]} intensity={1.5} color="#ffffff" />
      
      {/* The Central Data Stream */}
      {world.queue.map((card, i) => (
        <DataCube key={card.id} card={card} index={i} total={world.queue.length} />
      ))}

      {/* The Surrounding Server Racks */}
      {allPackIds.map((packId, i) => (
        <ServerRack 
          key={packId} 
          packId={packId} 
          index={i} 
          total={allPackIds.length} 
          isUnlocked={world.packs[packId as keyof typeof world.packs].unlocked} 
        />
      ))}

      {/* Atmospheric Particles */}
      <Sparkles count={200} scale={15} size={2} speed={0.4} color="#0ea5e9" />
    </group>
  );
}

export function WarRoom3D({ world }: { world: WorldSnapshot }) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: -1, background: 'radial-gradient(circle at center, #0f172a 0%, #020617 100%)' }}>
      <Canvas camera={{ position: [0, 5, 12], fov: 60 }}>
        <Scene world={world} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}


