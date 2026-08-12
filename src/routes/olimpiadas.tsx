import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client'; // Asegúrate de ajustar esta ruta

const Olimpiadas = ({ currentUser }) => {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEventos();
  }, []);

  const fetchEventos = async () => {
    const { data, error } = await supabase
      .from('eventos_olimpiadas')
      .select('*')
      .eq('estado', 'abierto');
    
    if (data) setEventos(data);
    setLoading(false);
  };

  const realizarApuesta = async (evento, prediccion, monto) => {
    // 1. Validar si ya cerró
    if (new Date() > new Date(evento.fecha_cierre)) {
      alert("Este evento ya cerró sus apuestas.");
      return;
    }

    // 2. Insertar apuesta (Aquí deberías también restar las coins del user)
    const { error } = await supabase.from('apuestas_olimpiadas').insert([
      { user_name: currentUser, evento_id: evento.id, monto, prediccion }
    ]);

    if (error) alert("Error al apostar: " + error.message);
    else alert("¡Apuesta registrada!");
  };

  if (loading) return <div>Cargando eventos...</div>;

  return (
    <div className="olimpiadas-container">
      <h1>Olimpiadas</h1>
      {eventos.map((evento) => {
        const estaCerrado = new Date() > new Date(evento.fecha_cierre);
        
        return (
          <div key={evento.id} className="evento-card">
            <h3>{evento.nombre_evento}</h3>
            <p>Cierre de apuestas: {new Date(evento.fecha_cierre).toLocaleString()}</p>
            
            {!estaCerrado ? (
              <div className="botones-apuesta">
                <button onClick={() => realizarApuesta(evento, 'A', 10)}>
                  Apostar a {evento.opcion_a} (Cuota {evento.cuota_a})
                </button>
                <button onClick={() => realizarApuesta(evento, 'B', 10)}>
                  Apostar a {evento.opcion_b} (Cuota {evento.cuota_b})
                </button>
              </div>
            ) : (
              <p className="cerrado">Apuestas cerradas para este evento.</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default Olimpiadas;